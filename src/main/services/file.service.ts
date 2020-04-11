import fs from 'fs';
import path from 'path';
import { injectable } from '@/common/decorator/injectable';
import { LogService } from './log.service';
import chokidar from 'chokidar';
import { isPicture, naturalCompare } from '@/common/utils';
import { ipcMain, ipcRenderer } from 'electron';
import { TreeNodeNormal } from 'antd/lib/tree/Tree';
import { mainWindow } from '@/main';
import { isArray, isUndefinedOrNull } from '@/common/types';
import { command } from '@/common/constant/command.constant';
import { ITreeDataNode } from '@/renderer/parts/fileBar/directoryView/directoryTree/directoryTree';
import { page } from '@/renderer/parts/mainView/mainView';
import { picture } from '@/renderer/parts/mainView/pictureView/pictureView';

@injectable
export class FileService {
    constructor(private readonly logService: LogService) { }

    MAX_RECURSIVE_DEPTH: number = 2;

    initial() {
        ipcMain.on(command.SELECT_DIR_IN_TREE, (event, data: page) => {
            const { id, type, title } = data;
            const url = id;
            const resolvedUrl = this.pr(url);
            const dirIsExists = fs.existsSync(resolvedUrl);
            if (!dirIsExists) return;

            const dirInfo = fs.readdirSync(resolvedUrl);
            const filteredDirInfo: string[] = [];
            const getFileterdDirInfoPromises = dirInfo.map((fileOrDirName, index) =>
                new Promise(resolve => {
                    if (!isPicture(fileOrDirName)) resolve();
                    const fileOrDirUrl = this.pr(url, fileOrDirName);
                    fs.stat(fileOrDirUrl, (err, stat) => {
                        if (stat.isFile()) filteredDirInfo[index] = fileOrDirName;
                        resolve();
                    });
                }));

            Promise.all(getFileterdDirInfoPromises).then(() => {
                console.log(filteredDirInfo);
                const pictureData = filteredDirInfo
                    .filter(item => !isUndefinedOrNull(item))
                    .map((filename, index) => ({
                        id: index,
                        url: this.pr(url, filename),
                        title: filename
                    }))
                    .sort((a, b) => naturalCompare(a.title, b.title));

                event.reply(command.RECEIVE_PICTURE, { id, data: pictureData, title, type });
            });

            // dirInfo = dirInfo.filter(fileOrDirName => {
            //     if (!isPicture(fileOrDirName)) return false;

            //     const fileOrDirUrl = this.pr(url, fileOrDirName);
            //     if (fs.statSync(fileOrDirUrl).isDirectory()) return false;

            //     return true;
            // });

            // const pictureData: picture[] = dirInfo
            //     .map((filename, index) => ({
            //         id: index,
            //         url: this.pr(url, filename),
            //         title: filename
            //     }))
            //     .sort((a, b) => naturalCompare(a.title, b.title));

            // event.reply(command.RECEIVE_PICTURE, { id, data: pictureData, title, type });
        });
    }

    /** directory tree methods */

    // invoke in import
    loadDir(
        dir: string,
        options: {
            level: number;
            time?: number;
            keySuffix?: string;
        } = {
                level: 0,
                time: 0
            }
    ): Promise<ITreeDataNode> {
        if (!options.time) options.time = 0;
        return new Promise(resolveTop => {
            const dirInfo = fs.readdirSync(dir);

            const dirTitle = (dir.match(/[^\\/]+$/) || []).pop();
            const suffix = options.keySuffix || `|${dirTitle}`;
            const tree: ITreeDataNode = {
                title: dirTitle,
                key: `${dir}${suffix}`
            };

            const childrenDir: ITreeDataNode[] = [];

            if (options.level < this.MAX_RECURSIVE_DEPTH) {
                const promises = dirInfo.map(
                    (fileOrDirName, index) =>
                        new Promise(resolve => {
                            const fileOrDirUrl = this.pr(dir, fileOrDirName);
                            fs.stat(fileOrDirUrl, (err, stats) => {
                                if (stats.isDirectory()) {
                                    this.loadDir(fileOrDirUrl, { level: options.level + 1, time: index++, keySuffix: suffix }).then(val => {
                                        childrenDir[index] = val;
                                    });
                                }
                                resolve();
                            });
                        })
                );
                Promise.all(promises).then(() => {
                    const childrenDirWithoutNullAndUndefined = childrenDir.filter(item => !isUndefinedOrNull(item));
                    if (childrenDirWithoutNullAndUndefined.length > 0) {
                        if (tree.children && isArray(tree.children)) tree.children.splice(0, 0, ...childrenDirWithoutNullAndUndefined);
                        else tree.children = childrenDirWithoutNullAndUndefined;
                    }
                    resolveTop(tree);
                });
            } else {
                resolveTop(tree);
            }
        });
    }

    async openDirByImport(dir: string, auto: boolean): Promise<void> {
        const tree = await this.loadDir(dir);
        mainWindow.webContents.send(command.OPEN_DIR_BY_IMPORT, {
            autoImport: auto,
            tree
        });
    }

    /** configuration methods */
    getDirInfoSync(url: string): string[] {
        if (fs.existsSync(this.pr(url))) return fs.readdirSync(this.pr(url));
        return null;
    }

    loadJsonSync(...url: string[]): any {
        const absUrl: string = path.resolve(...url);
        try {
            const buffer = fs.readFileSync(absUrl) as unknown;
            return JSON.parse(buffer as string);
        } catch (err) {
            this.logService.error(err);
            throw err;
        }
    }

    writeJson(url: string, id: string, content: any) {
        const absUrl: string = path.resolve(url, id) + '.json';
        const writeString: string = typeof content === 'string' ? content : JSON.stringify(content, null, 4);
        fs.writeFile(absUrl, writeString, () => {
            this.logService.log('update successfully');
        });
    }

    private pr(...args: string[]): string {
        return path.resolve(...args);
    }
}
