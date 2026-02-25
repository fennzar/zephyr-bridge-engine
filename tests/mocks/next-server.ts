export class NextResponse extends Response {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
  }

  static json(data: unknown, init: ResponseInit & { status?: number } = {}) {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const { status, ...rest } = init;
    return new NextResponse(JSON.stringify(data), {
      ...rest,
      status: status ?? 200,
      headers,
    });
  }

  static redirect(url: string | URL, status = 307) {
    const headers = new Headers({ location: url.toString() });
    return new NextResponse(null, { status, headers });
  }
}

export class NextRequest extends Request {
  public nextUrl: URL;

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const href =
      input instanceof URL
        ? input.toString()
        : typeof input === "string"
          ? input
          : input?.url ?? "http://localhost";
    super(href, init);
    this.nextUrl = new URL(href);
  }
}

export type NextResponseInit = ResponseInit;
