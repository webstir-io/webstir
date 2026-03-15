declare const Bun: {
  file(path: string | URL): Blob & {
    text(): Promise<string>;
  };
  write(destination: string | URL, input: string | Blob): Promise<number>;
};
