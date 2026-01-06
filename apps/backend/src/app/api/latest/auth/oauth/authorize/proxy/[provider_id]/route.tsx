import { checkApiKeySet } from "@/lib/internal-api-keys";
import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { decodeAccessToken, oauthCookieSchema } from "@/lib/tokens";
import { getProjectBranchFromClientId, getProvider } from "@/oauth";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { urlSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { generators } from "openid-client";
import * as yup from "yup";

const outerOAuthFlowExpirationInMinutes = 10;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "OAuth authorize endpoint",
    description: "This endpoint is used to initiate the OAuth authorization flow. there are two purposes for this endpoint: 1. Authenticate a user with an OAuth provider. 2. Link an existing user with an OAuth provider.",
    tags: ["Oauth"],
  },
  request: yupObject({
    params: yupObject({
      provider_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      // custom parameters
      type: yupString().oneOf(["authenticate", "link"]).default("authenticate"),
      token: yupString().default(""),
      provider_scope: yupString().optional(),
      /**
       * @deprecated
       */
      error_redirect_url: urlSchema.optional().meta({ openapiField: { hidden: true } }),
      error_redirect_uri: urlSchema.optional(),
      after_callback_redirect_url: yupString().optional(),

      // oauth parameters
      client_id: yupString().defined(),
      client_secret: yupString().defined(),
      redirect_uri: urlSchema.defined(),
      //redirect_uri: yupString().defined(),
      scope: yupString().defined(),
      state: yupString().defined(),
      grant_type: yupString().oneOf(["authorization_code"]).defined(),
      code_challenge: yupString().defined(),
      code_challenge_method: yupString().defined(),
      response_type: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      url: urlSchema.defined(),
    }).defined(),
  }),
  async handler({ params, query }, fullReq) {
    const tenancy = await getSoleTenancyFromProjectBranch(...getProjectBranchFromClientId(query.client_id), true);

    if (!tenancy) {
      throw new KnownErrors.InvalidOAuthClientIdOrSecret(query.client_id);
    }

    if (!(await checkApiKeySet(tenancy.project.id, { publishableClientKey: query.client_secret }))) {
      throw new KnownErrors.InvalidPublishableClientKey(tenancy.project.id);
    }

    const providerRaw = Object.entries(tenancy.config.auth.oauth.providers).find(([providerId, _]) => providerId === params.provider_id);
    const provider = providerRaw ? { id: providerRaw[0], ...providerRaw[1] } : undefined;
    if (!provider) {
      throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
    }

    // If the authorization token is present, we are adding new scopes to the user instead of sign-in/sign-up
    let projectUserId: string | undefined;
    if (query.type === "link") {
      const result = await decodeAccessToken(query.token, { allowAnonymous: true });
      if (result.status === "error") {
        throw result.error;
      }
      const { userId, projectId: accessTokenProjectId, branchId: accessTokenBranchId } = result.data;

      if (accessTokenProjectId !== query.client_id) {
        throw new StatusError(StatusError.Forbidden, "The access token is not valid for this project");
      }
      if (accessTokenBranchId !== tenancy.branchId) {
        throw new StatusError(StatusError.Forbidden, "The access token is not valid for this branch");
      }

      if (query.provider_scope && provider.isShared) {
        throw new KnownErrors.OAuthExtraScopeNotAvailableWithSharedOAuthKeys();
      }
      projectUserId = userId;
    }

    const innerCodeVerifier = generators.codeVerifier();
    const innerState = generators.state();
    const providerObj = await getProvider(provider);

    const oauthUrl = providerObj.getAuthorizationUrl({
      codeVerifier: innerCodeVerifier,
      state: innerState,
      extraScope: query.provider_scope,
    });

    // Store OAuth state in database - this is the source of truth for validation
    // Note: Cookie-based CSRF protection is not used for proxy flows because:
    // - Next.js 16 bug: cookies().set() fails with custom Response objects
    // - Proxy flows: cookie domain mismatch between gaming-api and Stack Auth
    // - Capacitor apps: in-app browsers don't share cookies
    // The database record + cryptographic state parameter provide sufficient CSRF protection
    await globalPrismaClient.oAuthOuterInfo.create({
      data: {
        innerState,
        info: {
          tenancyId: tenancy.id,
          publishableClientKey: query.client_secret,
          redirectUri: query.redirect_uri.split('#')[0], // remove hash
          scope: query.scope,
          state: query.state,
          grantType: query.grant_type,
          codeChallenge: query.code_challenge,
          codeChallengeMethod: query.code_challenge_method,
          responseType: query.response_type,
          innerCodeVerifier: innerCodeVerifier,
          type: query.type,
          projectUserId: projectUserId,
          providerScope: query.provider_scope,
          errorRedirectUrl: query.error_redirect_uri || query.error_redirect_url,
          afterCallbackRedirectUrl: query.after_callback_redirect_url,
        } satisfies yup.InferType<typeof oauthCookieSchema>,
        expiresAt: new Date(Date.now() + 1000 * 60 * outerOAuthFlowExpirationInMinutes),
      },
    });

    return {
      body: { url: oauthUrl },
      statusCode: 200,
      bodyType: "json",
    };
  },
});
