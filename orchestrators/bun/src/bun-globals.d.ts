interface BunShell {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  cwd(cwd: string): BunShell;
}

declare const Bun: {
  $: BunShell;
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
  Transpiler: new (options: {
    loader: 'ts' | 'tsx' | 'js' | 'jsx';
  }) => {
    scanImports(code: string): Array<{ path: string; kind: string }>;
    scan(code: string): { exports: string[]; imports: Array<{ path: string; kind: string }> };
  };
};
