declare module 'gray-matter' {
  export interface GrayMatterFile<T = any> {
    data: T;
    content: string;
    excerpt?: string;
    orig?: Buffer | string;
    language?: string;
    matter?: string;
    isEmpty?: boolean;
  }

  export interface GrayMatterOptions {
    excerpt?: boolean | ((file: any, options?: any) => boolean);
    excerpt_separator?: string;
    engines?: Record<string, any>;
    language?: string;
    delimiters?: string | [string, string];
    [key: string]: any;
  }

  export interface GrayMatter {
    <T = any>(str: string | Buffer, options?: GrayMatterOptions): GrayMatterFile<T>;
    stringify(file: string | object, data?: object, options?: GrayMatterOptions): string;
    read(fp: string, options?: GrayMatterOptions): GrayMatterFile<any>;
    test(str: string, options?: GrayMatterOptions): boolean;
  }

  const matter: GrayMatter;
  export default matter;
}
