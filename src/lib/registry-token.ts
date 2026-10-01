import { createPrivateKey, randomUUID, X509Certificate } from "node:crypto"
import { readFile } from "node:fs/promises"
import { SignJWT } from "jose"
import { config } from "./config"

export type RegistryAccess = { type: string; name: string; actions: string[] }
let keyMaterial:
  Promise<{ key: ReturnType<typeof createPrivateKey>; certificate: string }> | undefined

function signingMaterial() {
  return (keyMaterial ??= (async () => {
    const [keyPem, certPem] = await Promise.all([
      readFile(
        /* turbopackIgnore: true */ process.env.REGISTRY_TOKEN_KEY_PATH ?? "/certs/token.key",
        "utf8",
      ),
      readFile(
        /* turbopackIgnore: true */ process.env.REGISTRY_TOKEN_CERT_PATH ?? "/certs/token.crt",
        "utf8",
      ),
    ])
    return {
      key: createPrivateKey(keyPem),
      certificate: new X509Certificate(certPem).raw.toString("base64"),
    }
  })())
}

export async function signRegistryToken(subject: string, access: RegistryAccess[]) {
  const { key, certificate } = await signingMaterial()
  return new SignJWT({ access })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", x5c: [certificate] })
    .setIssuer(config.issuer)
    .setAudience(config.service)
    .setSubject(subject)
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000) - 5)
    .setExpirationTime("5m")
    .setJti(randomUUID())
    .sign(key)
}
