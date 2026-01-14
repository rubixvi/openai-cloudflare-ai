export async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = []
	const reader = stream.getReader()

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value) chunks.push(value)
		}

		const concatenated = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0))

		let offset = 0
		for (const chunk of chunks) {
			concatenated.set(chunk, offset)
			offset += chunk.length
		}

		return concatenated
	} finally {
		reader.releaseLock()
	}
}
