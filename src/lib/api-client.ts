export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? "Request failed. Please try again.")
  return data
}
