
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const readline = require('readline');

async function* createLineIterator(filePath) {
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
    });
    for await (const line of rl) {
        yield line;
    }
}

async function reformatSRecordFile(filePath) {
    const sRecordReformat = new SRecordReformat(filePath.fsPath);
    await sRecordReformat.reformatSRecordFile();
    return await sRecordReformat.generateNewSRecords(false);
}

async function reformatSRecordFileInDocument(filePath) {
    const sRecordReformat = new SRecordReformat(filePath.fsPath);
    await sRecordReformat.reformatSRecordFile();
    return await sRecordReformat.generateNewSRecords(true);

}


class SRecordReformat {
    constructor(filePath) {
        this.filePath = filePath;
        this.var_env = {}
        this.setVariable();
        this.seg_data_format = vscode.workspace.getConfiguration('srecordReformat').get('segDataFormat', 'S2');
        this.seg_data_length = vscode.workspace.getConfiguration('srecordReformat').get('segDataLength', 16);
        this.seg_data_fill = vscode.workspace.getConfiguration('srecordReformat').get('segDataFill', 0);
        this.seg_data_min_interval = vscode.workspace.getConfiguration('srecordReformat').get('segDataMinInterval', 200);
        this.reformat_file_format = vscode.workspace.getConfiguration('srecordReformat').get('reformatFileFormat', '${fileDirname}/${fileBasenameNoExtension}_reformatted${fileExtname}');
        // 解析变量并替换到 reformat_file_format 中
        this.reformat_file_format = this.resolveVariables(this.reformat_file_format);

        // 使用映射存储地址 -> 数据，便于稀疏写入
        this.dataMap = new Map();
    }

    resolveVariables(str) {
        return str.replace(/\$\{(\w+)\}/g, (match, varName) => {
            return this.var_env[varName] || match;  // 若变量未定义，保留原字符串
        });
    }
    setVariable() {
        this.var_env['workspaceFolder'] = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.var_env['file'] = this.filePath;
        this.var_env['fileBasename'] = path.basename(this.filePath);
        this.var_env['fileBasenameNoExtension'] = path.parse(this.filePath).name;
        this.var_env['fileExtname'] = path.extname(this.filePath);
        this.var_env['fileDirname'] = path.dirname(this.filePath);

    }

    async reformatSRecordFile() {
        let lastDataEnd = null;  // 上一个数据段的结束地址
        for await (const line of createLineIterator(this.filePath)) {
            if (line.startsWith('S')) {
                const record = this.parseSRecord(line);
                if (record && record.valid) {
                    if (['S0', 'S9', 'S8', 'S7'].includes(record.type)) {
                        // 处理 S0 记录（文件头），如果需要的话
                        if (record.type === 'S0') {
                            this.s0Record = record;  // 可以存储 S0 记录以便后续使用（如生成新的 S0 记录等）
                        }
                        else {
                            // 处理结束记录（S7/S8/S9），如果需要的话
                            this.endRecord = record;  // 可以存储结束记录以便后续使用（如生成新的结束记录等）
                        }
                    }
                    // 只处理数据记录 S1/S2/S3
                    if (['S1', 'S2', 'S3'].includes(record.type)) {
                        // 将 hex 字符串转为 Buffer
                        const dataBuf = Buffer.from(record.data, 'hex');
                        // 存入映射（若有重叠，按需求处理，此处简单覆盖）
                        if (lastDataEnd !== null && record.address < lastDataEnd) {
                            // 处理重叠（可以选择覆盖、跳过或合并数据等）
                            vscode.window.showErrorMessage(`数据重叠：地址 0x${record.address.toString(16)} 与上一个数据段结束地址 0x${lastDataEnd.toString(16)} 重叠。`);
                        }
                        if (lastDataEnd !== null && record.address == lastDataEnd) {
                            // 紧邻数据段，直接合并
                            let existing = null;
                            this.dataMap.forEach((value, key) => {
                                if (value.end === lastDataEnd) {
                                    existing = value;  // 找到紧邻的段
                                }
                            });
                            if (existing) {
                                existing.data = Buffer.concat([existing.data, dataBuf]);
                                existing.end = record.address + record.data_length;
                                existing.length += dataBuf.length;
                                lastDataEnd = existing.end;
                                if (existing.end - existing.start !== existing.length) {
                                    // 如果合并后数据段长度不等
                                    vscode.window.showErrorMessage(`合并后数据段长度 ${existing.end - existing.start} 不等于设定的段数据长度 ${this.seg_data_length}。`);
                                }
                            } else {
                                // 没有找到上一个段，直接存储当前段
                                this.dataMap.set(record.address, { start: record.address, end: record.address + record.data_length, data: dataBuf, length: dataBuf.length });
                                lastDataEnd = record.address + record.data_length;
                            }
                        }
                        else if (lastDataEnd !== null && record.address > lastDataEnd && (record.address - lastDataEnd) < this.seg_data_min_interval) {
                            // 处理间隔 (间隔小于设定值时，可以选择合并数据段或插入填充数据等)
                            let existing = null;
                            this.dataMap.forEach((value, key) => {
                                if (value.end === lastDataEnd) {
                                    existing = value;  // 找到上一个段
                                }
                            });
                            if (existing) {
                                // 插入填充数据
                                const fillLength = record.address - lastDataEnd;
                                const fillBuf = Buffer.alloc(fillLength, this.seg_data_fill);
                                existing.data = Buffer.concat([existing.data, fillBuf, dataBuf]);
                                existing.end = record.address + record.data_length;
                                existing.length += fillBuf.length + dataBuf.length;
                                lastDataEnd = existing.end;
                                if (existing.end - existing.start !== existing.length) {
                                    // 如果合并后数据段长度不等
                                    vscode.window.showErrorMessage(`合并后数据段长度 ${existing.end - existing.start} 不等于设定的段数据长度 ${this.seg_data_length}。`);
                                }
                            }
                            else {
                                // 没有找到上一个段，直接存储当前段
                                this.dataMap.set(record.address, { start: record.address, end: record.address + record.data_length, data: dataBuf, length: dataBuf.length });
                                lastDataEnd = record.address + record.data_length;
                            }
                        }
                        else if (lastDataEnd !== null && record.address > lastDataEnd) {
                            // 处理间隔 (间隔大于设定值时，重新开始新的数据段)
                            this.dataMap.set(record.address, { start: record.address, end: record.address + record.data_length, data: dataBuf, length: dataBuf.length });
                            lastDataEnd = record.address + record.data_length;
                        }
                        else if (lastDataEnd == null) {
                            // 首个数据段
                            this.dataMap.set(record.address, { start: record.address, end: record.address + record.data_length, data: dataBuf, length: dataBuf.length });  // 还可存储类型、原行等信息以便后续处理
                            lastDataEnd = record.address + record.data_length;
                        }
                    }
                }
            }
        }
    }

    async generateNewSRecords(inDocument) {
        try {        // 1. 对地址排序
            const sortedAddresses = Array.from(this.dataMap.keys()).sort((a, b) => a - b);
            // 2. 遍历生成新记录，处理间隔和填充...
            //    （需要输出符合 this.seg_data_format 的行）
            // 3. 将新记录写入文件 this.reformat_file_format
            // 4. 返回新文件路径或生成结果
            if (inDocument) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;
                const uri = vscode.Uri.file(this.filePath);
                const newContent = [];
                if (this.s0Record) {
                    const s0Line = `${this.s0Record.type}${this.s0Record.length.toString(16).toUpperCase().padStart(2, '0')}${this.s0Record.address.toString(16).toUpperCase().padStart(this.s0Record.address_length * 2, '0')}${this.s0Record.data}${this.s0Record.checksum.toString(16).toUpperCase().padStart(2, '0')}`;
                    newContent.push(s0Line);
                }
                for (const addr of sortedAddresses) {
                    const segment = this.dataMap.get(addr);
                    const sRecordLine = this.createSRecordLine(segment);
                    newContent.push(sRecordLine.join('\n'));
                }
                if (this.endRecord) {
                    newContent.push(`${this.endRecord.type}${this.endRecord.length.toString(16).toUpperCase().padStart(2, '0')}${this.endRecord.address.toString(16).toUpperCase().padStart(this.endRecord.address_length * 2, '0')}${this.endRecord.data}${this.endRecord.checksum.toString(16).toUpperCase().padStart(2, '0')}`);
                }
                else {
                    newContent.push(`S9030000FC`);  // 默认写入一个简单的 S9 结束记录，地址为 0，校验和为 0xFA（根据 S-record 规范计算）
                }
                // edit.createFile(uri);
                await editor.edit((editBuilder) => {
                    // 替换整个文档内容
                    const firstLine = editor.document.lineAt(0);
                    const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
                    const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
                    editBuilder.replace(fullRange, newContent.join('\n'));
                })
                // edit.replace(uri, new vscode.Position(0, 0), newContent.join('\n'));
                // await vscode.workspace.applyEdit(edit);
                return true;
            }
            else {
                const newFilePath = this.reformat_file_format;
                const writeStream = fs.createWriteStream(newFilePath);
                // 写入 S0 记录（如果需要的话）
                if (this.s0Record) {
                    const s0Line = `${this.s0Record.type}${this.s0Record.length.toString(16).toUpperCase().padStart(2, '0')}${this.s0Record.address.toString(16).toUpperCase().padStart(this.s0Record.address_length * 2, '0')}${this.s0Record.data}${this.s0Record.checksum.toString(16).toUpperCase().padStart(2, '0')}`;
                    writeStream.write(s0Line + '\n');
                }
                for (const addr of sortedAddresses) {
                    const segment = this.dataMap.get(addr);
                    // 根据 segment 数据生成 S-record 行（需要根据 this.seg_data_format 确定地址长度、数据长度等）
                    const sRecordLine = this.createSRecordLine(segment);
                    writeStream.write(sRecordLine.join('\n'));
                    writeStream.write('\n');
                }
                // 可以选择写入结束记录（如 S7/S8/S9）等
                if (this.endRecord) {
                    writeStream.write(`${this.endRecord.type}${this.endRecord.length.toString(16).toUpperCase().padStart(2, '0')}${this.endRecord.address.toString(16).toUpperCase().padStart(this.endRecord.address_length * 2, '0')}${this.endRecord.data}${this.endRecord.checksum.toString(16).toUpperCase().padStart(2, '0')}`);
                }
                else {
                    writeStream.write(`S9030000FC`);  // 默认写入一个简单的 S9 结束记录，地址为 0，校验和为 0xFA（根据 S-record 规范计算）
                }
                writeStream.end();

                return true;
            }
        } catch (err) {
            vscode.window.showErrorMessage(`生成新S-record文件失败：${err.message}`);
            return false;
        }
    }

    createSRecordLine(segment) {
        // 根据 this.seg_data_format 确定 S-record 类型（S1/S2/S3）
        let type;
        // 计算长度（地址字节数 + 数据字节数 + 校验字节）
        let addrBytes;
        switch (this.seg_data_format) {
            case 'S1': addrBytes = 2; type = 'S1'; break;
            case 'S2': addrBytes = 3; type = 'S2'; break;
            case 'S3': addrBytes = 4; type = 'S3'; break;
            default: throw new Error(`不支持的段数据格式：${this.seg_data_format}`);
        }

        const dataBytes = segment.length;
        // 构建 S-record 行
        const dataHex = segment.data.toString('hex').toUpperCase();

        const lines = [];
        for (let i = 0; i < dataBytes; i += this.seg_data_length) {
            const addrHex = (segment.start + i).toString(16).toUpperCase().padStart(addrBytes * 2, '0');
            const dataChunk = dataHex.substr(i * 2, this.seg_data_length * 2);
            const length = addrBytes + (this.seg_data_length <= (dataChunk.length / 2) ? this.seg_data_length : dataChunk.length / 2) + 1;  // +1 for checksum
            const lengthHex = length.toString(16).toUpperCase().padStart(2, '0');
            const checksum = (length + addrHex.match(/.{2}/g).reduce((sum, byte) => sum + parseInt(byte, 16), 0)) + dataChunk.match(/.{2}/g).reduce((sum, byte) => sum + parseInt(byte, 16), 0) ^ 0xFF;
            lines.push(`${type}${lengthHex}${addrHex}${dataChunk}${(checksum % 0x100).toString(16).toUpperCase().padStart(2, '0')}`);
        }

        return lines;
    }

    parseSRecord(line) {
        // 去掉首尾空白
        line = line.trim();

        // 正则解析整体结构
        const match = line.match(/^S(\d)([0-9A-F]{2})([0-9A-F]+)([0-9A-F]{2})$/i);
        if (!match) return null;   // 格式不符

        const [, typeChar, lengthHex, addrAndData, checksumHex] = match;
        const type = parseInt(typeChar, 10);       // 0-9
        const length = parseInt(lengthHex, 16);    // 字节数

        // 根据类型确定地址字节数
        let addrBytes;
        switch (type) {
            case 0: case 1: case 9:
                addrBytes = 2; break;
            case 2: case 8:
                addrBytes = 3; break;
            case 3: case 7:
                addrBytes = 4; break;
            case 5:
                addrBytes = 2;  // S5 是2字节计数，当地址解析
                break;
            default:
                return null;    // 不支持的类型
        }

        // 校验总长度：addrAndData 的十六进制位数 = (length - 1) * 2
        // （因为 length 包含地址、数据、校验，不含自身）
        const expectedHexLen = (length - 1) * 2;
        if (addrAndData.length !== expectedHexLen) return null;

        // 切出地址部分和数据部分
        const addrHexLen = addrBytes * 2;
        const addressHex = addrAndData.slice(0, addrHexLen);
        const dataHex = addrAndData.slice(addrHexLen);
        const dataBytesLength = length - 1 - addrBytes;  // 数据字节数 = 总长度 - 1（校验） - 地址字节数

        // 组装用于校验和的字节数组（长度字节 + 地址字节 + 数据字节）
        const bytes = [];
        // 将长度字节加入
        bytes.push(length);
        // 地址字节
        for (let i = 0; i < addressHex.length; i += 2) {
            bytes.push(parseInt(addressHex.substr(i, 2), 16));
        }
        // 数据字节
        for (let i = 0; i < dataHex.length; i += 2) {
            bytes.push(parseInt(dataHex.substr(i, 2), 16));
        }

        // 累加所有字节及校验和，低8位应为 0xFF
        let sum = bytes.reduce((s, b) => s + b, 0) + parseInt(checksumHex, 16);
        const valid = (sum & 0xFF) === 0xFF;

        return {
            type: `S${type}`,
            length,
            data_length: dataBytesLength,
            address: parseInt(addressHex, 16),
            address_length: addrBytes,
            data: dataHex,                     // 原始 hex 字符串，或转为 Buffer
            checksum: parseInt(checksumHex, 16),
            valid,
        };
    }
}

/** 自动补全生成的 S19 文件 */
async function autoCompleteGeneratedS19() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;
    const var_env = {
        "workspaceFolder": workspaceFolders?.[0]?.uri.fsPath || ''
    }
    function resolveVariables(str) {
        return str.replace(/\$\{(\w+)\}/g, (match, varName) => {
            return var_env[varName] || match;  // 若变量未定义，保留原字符串
        });
    }
    const config = vscode.workspace.getConfiguration("cmake").get("buildDirectory") //拿到Cmake config 
    if (!config) { vscode.window.showErrorMessage(`cmake.buildDirectory is not set`); return }
    const resolve_path = resolveVariables(config);
    // 查找构建目录下的 S19 文件
    // 通过 langID 查找对应的 Srecord 文件 ， 依赖 jacksun.motorola-srecord

    const dirUri = vscode.Uri.file(resolve_path); // 将字符串路径转为 URI

    try {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);

        // 只提取所有文件的 Uri
        const files_withlangid = {};
        const files = entries
            .filter(([_, type]) => type === vscode.FileType.File)
            .map(([name, type]) => vscode.Uri.joinPath(dirUri, name))

        for (let idx = 0; idx < files.length; idx++) {
            let doc = null
            try {
                doc = await vscode.workspace.openTextDocument(files[idx]);
            } catch {
            }
            if (doc) {
                if (!files_withlangid[doc.languageId]) files_withlangid[doc.languageId] = [];
                files_withlangid[doc.languageId].push(files[idx])
            }
        }

        for (let idx = 0; idx < files_withlangid['s19'].length; idx++) {
            if (!files_withlangid['s19'][idx].fsPath.includes('format'))
                await reformatSRecordFile(files_withlangid['s19'][idx]);
        }
    } catch (error) {
        vscode.window.showErrorMessage(error)
    }
}

module.exports = {
    reformatSRecordFile,
    reformatSRecordFileInDocument,
    autoCompleteGeneratedS19
};