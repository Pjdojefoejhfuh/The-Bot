export declare function base85Encode(data: Uint8Array): string;
export declare function base85Decode(str: string): Uint8Array;
export interface ClydeBlob {
    blob: string;
    xorKey: number[];
    invSbox: number[];
    checksum: number;
    origLen: number;
}
export declare function encryptAndEncode(input: string, rng: () => number): ClydeBlob;
export declare function compressToBase85(input: string): string;
export declare function compressBytesToBase85(input: Uint8Array): string;
export declare function compress(input: Uint8Array): Uint8Array;
export declare function decompress(input: Uint8Array): Uint8Array;
//# sourceMappingURL=lzma.d.ts.map