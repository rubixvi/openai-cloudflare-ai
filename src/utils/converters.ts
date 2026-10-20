export function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''

  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize))
  }

  return btoa(binary)
}

export function base64ToUint8Array(value: string): Uint8Array {
  const encoded = value.replace(/^data:[^,]*;base64,/, '')
  const binary = atob(encoded)

  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
