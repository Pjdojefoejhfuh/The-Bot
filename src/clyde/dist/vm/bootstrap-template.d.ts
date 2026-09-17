export interface BootstrapConfig {
    vmBlob: string;
    vmOrigLen: number;
    xorKey: number[];
    invSbox: number[];
    checksum: number;
    chunkName?: string;
    rng: () => number;
}
export declare function generateBootstrap(config: BootstrapConfig): string;
//# sourceMappingURL=bootstrap-template.d.ts.map