export function hashContent(content: string, length = 8): string {
    const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');
    return hash.slice(0, length);
}
