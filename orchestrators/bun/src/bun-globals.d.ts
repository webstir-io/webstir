declare const Bun: {
  file(path: string | URL): Blob & {
    text(): Promise<string>;
  };
  write(destination: string | URL, input: string | Blob): Promise<number>;
  serve(options: {
    hostname?: string;
    idleTimeout?: number;
    port: number;
    fetch(request: Request): Response | Promise<Response>;
  }): {
    hostname: string;
    port: number;
    url: URL;
    stop(closeActiveConnections?: boolean): void;
  };
};
