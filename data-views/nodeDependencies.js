const vscode = require('vscode');
const search_file = require("../src/search_file")
const fs = require('fs');
const path = require('path');
const Collapsed = vscode.TreeItemCollapsibleState.Collapsed;
const Expanded = vscode.TreeItemCollapsibleState.Expanded;
const NoCollapsed = vscode.TreeItemCollapsibleState.None;

let terminal;
// 定义一个类实现 TreeDataProvider 接口
class MyTreeDataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    // 获取 TreeItem 表示形式
    getTreeItem(element) {
        return element;
    }

    // 获取子元素
    getChildren(element) {
        if (element) {
            return element.children || [];
        } else {
            // 返回根节点的子元素
            let res = []
            for (let index = 0; index < search_file.globalProjectConfig.length; index++) {
                const element = search_file.globalProjectConfig[index];
                let children = []
                for (let index = 0; index < element.configurations.length; index++) {
                    const config = element.configurations[index];
                    children.push(new MyTreeItem(config.name, "", []))
                }
                res.push(new MyTreeItem(element.name, element.projectName, children))
            }
            return res
            // return [
            //     new MyTreeItem('Node 1', "Description 1", [
            //         new MyTreeItem("Children Node 1", "This is children", []),
            //         new MyTreeItem("Children Node 2", "Another child", [
            //             new MyTreeItem("Grandchild Node 1", "Grandchild description", [])
            //         ])
            //     ]),
            //     new MyTreeItem('Node 2', "Description 2", [])
            // ];
        }
    }


    // 可选方法，返回元素的父元素
    getParent(element) {
        // 如果元素是根节点的子节点，返回 null 或 undefined
        if (element.parent) {
            return element.parent;
        }
        return null;
    }

    // 可选方法，解析 TreeItem 的某些属性
    resolveTreeItem(item, element, token) {
        // 动态解析 tooltip 或 command 属性
        if (!item.tooltip) {
            item.tooltip = `This is ${item.label}`;
        }
        return item;
    }

    // 触发数据变化事件
    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

// 定义一个 TreeItem 类
class MyTreeItem extends vscode.TreeItem {
    constructor(label,description,children) {
        if(children == undefined || children.length==0)
            super(label, NoCollapsed);
        else
            super(label, Collapsed);
        this.tooltip = `${label}`;
        this.description = `${description}`;
        this.children = children;
        this.contextValue=(children == undefined || children.length==0)?"":"hasChildren";
        for (let index = 0; index < this.children.length; index++) {
            let element = this.children[index];
            element.parent=this;
        }
        this.parent = undefined;
    }
}
function createDirectory(directory) {
    // 获取当前工作区的路径
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder is open.');
        return;
    }

    // 定义要创建的目录名称
    const dirName = directory;
    const dirPath = path.join(workspaceFolders[0].uri.fsPath, dirName);

    // 检查目录是否已经存在
    if (fs.existsSync(dirPath)) {
        // vscode.window.showInformationMessage(`Directory ${dirName} already exists.`);
        console.log(`Directory ${dirName} already exists.`);
        return;
    }

    // 创建目录
    fs.mkdir(dirPath, { recursive: true }, (err) => {
        if (err) {
            // vscode.window.showErrorMessage(`Failed to create directory: ${err.message}`);
            console.error(`Failed to create directory: ${err.message}`);
        } else {
            // vscode.window.showInformationMessage(`Directory ${dirName} created successfully.`);
            console.log(`Directory ${dirName} created successfully.`);
        }
    });
}

const executeBuildCommand = (element) =>{
    if (element.parent) {
        const globalConfig = vscode.workspace.getConfiguration("cdtheadlessbuild")
        const launchPath = globalConfig.get("launchPath","")
        if(launchPath==""){
            vscode.window.showErrorMessage("您没有设置launchPath!")
            return
        }
        let workspaceFolder = ''
        if (element.parent.description == '.')
            workspaceFolder = "../.vscode/cdtheadlessbuild/Default_WorkSpace"
        else
            workspaceFolder = `./.vscode/cdtheadlessbuild/${element.parent.description}_WorkSpace`
        createDirectory(workspaceFolder)
        let command = `${launchPath} --launcher.suppressErrors -nosplash -application org.eclipse.cdt.managedbuilder.core.headlessbuild -data ${workspaceFolder} -import ${element.parent.description} -build ${element.parent.label}/${element.label} `
        if(terminal == undefined)
            terminal = vscode.window.createTerminal("cdt-headless-build")
            terminal.show()
        terminal.sendText(command);
    }
    else
    {
        vscode.window.showErrorMessage("您正在尝试对一个无父节点进行单配置编译操作!")
    }
}

module.exports =
{
    MyTreeDataProvider,
    // findProjectFile
    executeBuildCommand,
}