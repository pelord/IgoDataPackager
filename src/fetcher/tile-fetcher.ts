import { BaseTileFetcherArgs } from './tile-fetcher-args.interface';
import { Tile } from './Tile';
import { finished } from 'stream/promises';
import axios, { AxiosError } from 'axios';
import { DOWNLOAD_DIR } from '../constants';
import { createWriteStream } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { DownloadedFile } from './downloaded-file.interface';
import { createFromTemplate } from 'ol/tileurlfunction.js';
import { UrlFunction } from 'ol/Tile';
import { PromisePool } from '@supercharge/promise-pool'
import TileSource from 'ol/source/Tile';

export abstract class TileFetcher {
    private urlGenerator: UrlFunction;

    constructor(private args: BaseTileFetcherArgs) {
        const { url, source } = args;
        if (!source.tileGrid) {
            throw Error('Invalid data source no tileGrid provided');
        }

        if (!source.getProjection()) {
            throw Error('Invalid data source no projection provided');
        }
        this.urlGenerator = createFromTemplate(url, source.tileGrid);
    }

    protected abstract getTiles(source: TileSource): Tile[];

    private getUrls(): string[] {
        const source = this.args.source;
        const tiles = this.getTiles(source);
        return tiles.map((tile) => {
            const url = this.urlGenerator(
                [tile.z, tile.x, tile.y],
                0,
                this.args.source.getProjection()!,
            );

            if (!url) {
                throw Error("Can't generate URL.");
            }
            return url;
        });
    }

    private getFileName(url: string) {
        const fileExtension = url.split('.').pop();
        if (fileExtension?.length == url.length) {
            return uuidv4();
        }
        return `${uuidv4()}.${fileExtension}`;
    }

    private getFilePath(fileName: string) {
        return `${DOWNLOAD_DIR}/${fileName}`
    }

    private async downloadData(url: string): Promise<DownloadedFile | undefined> {
        try {
            const res = await axios.get(url, {
                responseType: 'stream'
            });

            const fileName = this.getFileName(url);
            const path = this.getFilePath(fileName);

            const writer = res.data.pipe(createWriteStream(path));
            await finished(writer);
            return {
                url,
                fileName,
            };
        } catch (e: unknown) {
            if (!(e instanceof AxiosError)) {
                throw e;
            }
            if (e.response?.status !== 200) {
                console.error(`Tile fetch with url: ${url} have status led to ${e.response?.status}`);
            }
            return undefined;
        }
    }

    async fetch(): Promise<DownloadedFile[]> {
        const urls = this.getUrls();
        const { results: downloadedFiles, errors } = await PromisePool
            .withConcurrency(30)
            .for(urls)
            .process(async (url, index, pool) => {
                const downloaded = await this.downloadData(url);
                if (index % 50 == 0) {
                    console.log(`Download ${index / urls.length}% done`)
                }
                return downloaded;
            });
        return downloadedFiles.filter((file) => file !== undefined) as DownloadedFile[];
    }
}
