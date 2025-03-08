the task is to figur eout a solghtly different auth flow.

we have 3 systems

1. stack-backend (SB)
2. proxy-backend (PB)
3. bxg-frontend (BF)

so BF is the frontend, PB is the proxy, and SB is the backend.

BF initiates a google sign up request "http://localhost:3001/api/v1/oauth?provider_id=google" see code Example 1.
PB (Example 1) and sends reuest to SB @File ./apps/backend/src/routes/auth/oauth/authorize/proxy/route.ts
SB generates  correct google url and sends it back to PB wich passes it back FE
FE choose email and logins to google which then redirects to SB callback url @File ./apps/backend/src/routes/auth/oauth/callback/route.ts
SB Code seems to work it swaps te code for a token and then uses the token to fetch the user info etc

however when the  FE redirect_url is called it gets { code: '....', state: '....'} in the query params
I really want te token to be passed back so i can use it to fetch the user info etc

I can t see where redirct_url is being called from
and is this correct anyway ? or should I be calling "http://localhost:8102/api/v1/auth/oauth/token" with e code ?



```typescript
//Example 1
//proxy route handler for google auth
const AUTH_URL = 'http://localhost:8102/api/v1/auth/oauth/authorize/proxy'
export async function getOAuthAuthorize({ req, body, ctx, mdb }: BXGHandlerProps<{}>) {
  const qp = parseSearchParamsToObject(req)
  const {
    provider_id,
    error_redirect_uri,
  } = qp
  const { codeChallenge, state } = await saveVerifierAndState()
  const scope = [ 'legacy'  ].join(' ')
  //const redirect_uri = encodeURIComponent("http://localhost:3001/api/v1/oauth/callback")
  const redirect_uri = "http://localhost:3001/api/v1/oauth/callback"

  //const url = `${AUTH_URL}/api/v1/auth/oauth/authorize/${qp.provider_id}\
  const s = `${AUTH_URL}/${provider_id}`
  console.log('s', s)
  const url = new URL(`${AUTH_URL}/${provider_id}`)
  url.searchParams.set('client_id', NEXT_PUBLIC_STACK_PROJECT_ID as string)
  url.searchParams.set('client_secret', NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY as string)
  url.searchParams.set('redirect_uri', redirect_uri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', state)
  url.searchParams.set('grant_type', 'authorization_code')
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('type', 'authenticate')


  console.log('url', url.toString())
  console.log()

  try {
    //const response = await fetch(url, { method: 'GET', credentials: 'include' })
    const response = await fetch(url, { method: 'GET', credentials: 'include' })
    if(response.ok) {
      const data = await response.json()
      
      // Create normal JSON response instead of redirect
      const jsonResponse = NextResponse.json({ 
        ok: true, 
        url: data.url 
      })
      
      // Get and set cookies
      const setCookieHeader = response.headers.get('set-cookie')
      if (setCookieHeader) {
        // Split multiple cookies if present
        const cookies = setCookieHeader.split(',').map(cookie => cookie.trim())
        cookies.forEach(cookie => {
          console.log('cookie', cookie)
          jsonResponse.headers.append('Set-Cookie', cookie)
        })
      }

      return {
        resp: jsonResponse,
        payload: { ok: true, url: data.url },
      }
    } else {
      console.log('caught error', response)
      return handleError(response)
    }
  } catch(err) {
    console.error(err)
    return handleError(err)
  }
}
```


```typescript
//proxy route handler for google auth redirect
export async function oauthRedirect({ req, body, ctx, mdb }: BXGHandlerProps<{}>) {
  const qp = parseSearchParamsToObject(req)
  console.log('qp', qp)
  console.log('body', body)

  //qp has the code and state
  //e.g. { code: '....', state: '....'}

  return {
    resp: NextResponse.json({ ok: true }),
    payload: { ok: true },
  }
}
```
