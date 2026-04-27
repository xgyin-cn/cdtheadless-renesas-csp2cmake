const vscode = require("vscode");
const fs = require("fs");
const xml2js = require("xml2js");
const path = require("path");
const { RenesasMtpjParser } = require("./renesas-cli-parse");

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
let globalMtpjConfig = []; // { name, projectName, filePath, buildModes[], currentBuildMode }
let currentProject = null; // currently selected project (for Config view)
const currentProjectParser = new RenesasMtpjParser();
// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Decode a Base64 string safely */
function base64Decode(str) {
  try {
    return Buffer.from(str, "base64").toString("utf8");
  } catch {
    return str;
  }
}

/** Find all .mtpj files in the workspace */
async function findMtpjFiles() {
  const pattern = "**/*.mtpj";
  const files = await vscode.workspace.findFiles(pattern);
  return files.map((f) => f.fsPath);
}

/** Parse a .mtpj file and return structured data */
function parseMtpjFile(filePath) {
  try {
    const xml = fs.readFileSync(filePath, "utf8");
    let result = {};
    xml2js.parseString(xml, (err, parsed) => {
      if (err) {
        console.error("parseMtpj parse error:", err);
        return;
      }
      result = parsed;
    });

    const classes = result?.CubeSuiteProject?.Class || [];
    const file_list_data = classes.find((cls) => cls.$.Guid === "68f4a651-b9cd-473b-a595-b00447132ffa");
    const file_tree = {
      "category": {},
      "files": {}
    }

    if (file_list_data) {
      file_list_data.Instance.forEach((instance) => {
        if (instance.Type) {
          if (instance.Type[0] === "Category") {

          }
          else if (instance.Type[0] === "File") file_tree.files[instance.$.Guid] = instance.RelativePath[0];
        }
      })
    }

    const micro_type_class = classes.find(
      (cls) => cls.$.Guid === "096f2041-c115-4158-959e-885938314c77",
    );
    const micro_type = Object.assign({}, ...micro_type_class.Instance)
      .DeviceName[0];

    const matched_class = classes.find(
      (cls) => cls.$.Guid === "eb3b4b69-af1a-4dc1-b2bc-4b81a50fb2a4"
    );
    const excute_file_instance = matched_class.Instance.find((inst) => inst.$.Guid === "eb3b4b69-af1a-4dc1-b2bc-4b81a50fb2a4");

    const excute_files = {};

    for (let idx = 0; idx < parseInt(excute_file_instance.SourceItemCount?.[0] ?? "0"); idx++) {
      const source_item_type = excute_file_instance[`SourceItemType${idx}`]?.[0] ?? "";
      const source_item_guid = excute_file_instance[`SourceItemGuid${idx}`]?.[0] ?? "";
      excute_files[source_item_guid] = source_item_type;
    }

    const instance = Object.assign({}, ...matched_class.Instance);
    if (!instance) return null;

    const buildModeCount = parseInt(instance.BuildModeCount?.[0] ?? "0", 10);
    const currentBuildModeRaw = instance.CurrentBuildMode?.[0] ?? "";

    // Collect build modes
    const buildModes = [];
    for (let i = 0; i < buildModeCount; i++) {
      const encoded = instance[`BuildMode${i}`]?.[0] ?? "";
      buildModes.push({
        name: base64Decode(encoded).replaceAll("\x00", ""),
        encoded,
        index: i,
      });
    }
    const currentBuildModeIndex = buildModes.findIndex(
      (i) => i.name === currentBuildModeRaw,
    );
    const projectType =
      (instance["GeneralOptionOutput-" + currentBuildModeIndex]?.[0] ?? "") ===
        "LibraryFile"
        ? "lib"
        : "exe";

    // // Current build mode name (decode)
    const currentBuildMode = currentBuildModeRaw;

    // Source items
    // const sourceItemCount = parseInt(instance.SourceItemCount?.[0] ?? "0", 10);
    // const sourceItems = [];
    // for (let i = 0; i < sourceItemCount; i++) {
    //   sourceItems.push({
    //     guid: instance[`SourceItemGuid${i}`]?.[0] ?? "",
    //     type: instance[`SourceItemType${i}`]?.[0] ?? "",
    //   });
    // }

    const projectName = path.basename(filePath, ".mtpj");

    return {
      name: projectName,
      projectName,
      filePath,
      buildModes,
      currentBuildMode,
      currentBuildModeIndex,
      // sourceItemCount,
      // sourceItems,
      buildModeCount,
      matched_class,
      micro_type,
      projectType,
      file_tree,
      excute_files
    };
  } catch (err) {
    console.error("parseMtpj error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// TreeItem classes
// ─────────────────────────────────────────────────────────────
const Collapsed = vscode.TreeItemCollapsibleState.Collapsed;
const Expanded = vscode.TreeItemCollapsibleState.Expanded;
const NoCollapsed = vscode.TreeItemCollapsibleState.None;

class RenesasProjectItem extends vscode.TreeItem {
  /**
   * @param {object} data  parsed mtpj data
   * @param {string} [tooltipSuffix]  extra tooltip text
   */
  constructor(data, tooltipSuffix = "", haschildren = NoCollapsed) {
    super(data.name, haschildren);
    this.data = data;
    this.contextValue = "hasChildren";
    this.tooltip = [
      `📁 ${data.name}.mtpj`,
      `   Build Modes: ${data.buildModeCount}`,
      `   Current: ${data.currentBuildMode}`,
      tooltipSuffix,
    ]
      .filter(Boolean)
      .join("\n");
    this.description = data.currentBuildMode;
    this.iconPath = new vscode.ThemeIcon("symbol-folder");
  }
}

class RenesasBuildModeItem extends vscode.TreeItem {
  /**
   * @param {object} mode  { name, encoded, index }
   * @param {string} projectName
   */
  constructor(mode, projectName, haschildren = NoCollapsed) {

    super(mode.name, haschildren);
    this.mode = mode;
    this.projectName = projectName;
    this.contextValue = "buildModeItem";
    this.tooltip = `Build Mode: ${mode.name}`;
    this.description = `(#${mode.index + 1})`;
    this.iconPath = new vscode.ThemeIcon("wrench");
  }
}

class RenesasOptionClassItem extends vscode.TreeItem {
  /**
   * @param {object} src  { guid, type }
   */
  constructor(name, data) {
    super(name, Expanded);
    this.data = data;
    this.name = name;
    this.contextValue = "sourceItem";
    // this.tooltip = `Type: ${src.type}`;
    // this.description = src.type;
    this.iconPath = new vscode.ThemeIcon("gear");
  }
}

class RenesasOptionItem extends vscode.TreeItem {
  /**
   * @param {object} src  { guid, type }
   */
  constructor(name, obj, inactive) {
    super(name, NoCollapsed);
    this.obj = obj;
    this.name = name;
    this.contextValue = "optionItem";
    this.tooltip = `${obj.compileOptionOutputCli()}`;
    // this.description = src.type;
    if (inactive) {
      this.iconPath = new vscode.ThemeIcon("pass");
    } else {
      this.iconPath = new vscode.ThemeIcon("error");
    }
  }
}

// ─────────────────────────────────────────────────────────────
// RenesasCSP2CMakeConfig — project Config list view
// ─────────────────────────────────────────────────────────────
class RenesasProjectTreeDataProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (element) {
      // Second level: build modes
      if (element instanceof RenesasProjectItem) {
        const items = element.data.buildModes.map(
          (m) => new RenesasBuildModeItem(m, element.data.name, Expanded),
        );
        return items;
      }
      if (element instanceof RenesasBuildModeItem) {
        if (currentProjectParser.data?.currentBuildMode == element.mode.name) {
          return currentProjectParser.projectTypeMap[
            currentProjectParser.data.projectType
          ].map(
            (m) => new RenesasOptionClassItem(m, currentProjectParser.data),
          );
        }
        return [];
      }
      if (element instanceof RenesasOptionClassItem) {
        if (
          currentProjectParser.data.currentBuildMode ==
          element.data.currentBuildMode
        ) {
          const activeOptions =
            currentProjectParser.cli_maker[element.name].activet_options;
          const options = currentProjectParser.cli_maker[element.name].options;
          let res = [];
          options.forEach((value, key) => {
            if (activeOptions.includes(key)) {
              res.push(new RenesasOptionItem(key, value, true));
            } else {
              // res.push(new RenesasOptionItem(key, value, false));
            }
          });
          return res;
        }
      }
      return [];
    }
    // Root: return project list

    if (!currentProject && !element) {
      return [];
    } else if (!(currentProject instanceof RenesasProjectItem)) {
      return [new RenesasProjectItem(currentProject, "", Expanded)];
    }
  }

  refresh(node) {
    this._onDidChangeTreeData.fire(node);
  }
}

// ─────────────────────────────────────────────────────────────
// RenesasCSP2CMake — build mode view
// Shows build modes for the currently active project
// ─────────────────────────────────────────────────────────────
class RenesasBuildModeTreeDataProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (element instanceof RenesasProjectItem) {
      // Second level: build modes
      return element.data.buildModes.map(
        (m) => new RenesasBuildModeItem(m, element.data.name),
      );
    }

    // if (element instanceof RenesasBuildModeItem) {
    //   // Third level: source items of the current project
    //   return currentProject.sourceItems.map((s) => new RenesasSourceItem(s));
    // }

    if (!element) {
      // Root: single node for the current project
      const result = [];
      for (const proj of globalMtpjConfig) {
        result.push(new RenesasProjectItem(proj, "", true));
      }

      if (projectProvider) projectProvider.refresh();

      return result;
    }

    return [];
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }
}

// ─────────────────────────────────────────────────────────────
// Refresh / scan logic
// ─────────────────────────────────────────────────────────────
async function refreshAll() {
  globalMtpjConfig = [];
  const files = await findMtpjFiles();
  for (const fp of files) {
    const data = parseMtpjFile(fp);
    if (data) globalMtpjConfig.push(data);
  }
  globalMtpjConfig.sort((a, b) => a.name.localeCompare(b.name)); // sort alphabetically
  console.log(
    "[RenesasMtpj] Scanned projects:",
    globalMtpjConfig.map((p) => p.name),
  );

  // Auto-select first project if none selected
  if (!currentProject && globalMtpjConfig.length > 0) {
    globalMtpjConfig.sort((a, b) => a.name.localeCompare(b.name)); // sort alphabetically
    if (globalMtpjConfig.length == 1)
      currentProject = globalMtpjConfig[0];
  }

  if (buildModeProvider) buildModeProvider.refresh();
  if (projectProvider) projectProvider.refresh();
  return globalMtpjConfig;
}

// ─────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────

/** Build the selected project using the current build mode */
const buildProject = async (element) => {
  await refreshAll()
  if (element instanceof RenesasBuildModeItem) {
    currentProject = globalMtpjConfig.filter(
      (p) => p.name === element.projectName,
    )[0];
    await currentProjectParser.parseMtpjXmlObj(currentProject);
    if (projectProvider) projectProvider.refresh();
  }
  const data = element;
  vscode.window.showInformationMessage(
    `[Renesas Build] ${data.projectName}.mtpj  Current Build Mode: ${data.label}`,
  );
  // TODO: wire up actual build command (CS+ headless invocation)
  await currentProjectParser.generateCmakeCli();
  console.log(
    "[Renesas Build] Triggered for:",
    data.name,
    "mode:",
    data.currentBuildMode,
  );
};

/** Refresh the Renesas tree views */
const refreshEntry = async () => {
  await refreshAll();
  vscode.window.showInformationMessage("[Renesas CSP2CMake] 已刷新");
};

/** Set current project for Config view */
const setCurrentProject = async (element) => {
  if (element instanceof RenesasProjectItem) {
    currentProject = element.data;
    await currentProjectParser.parseMtpjXmlObj(currentProject);
    if (projectProvider) {
      // projectProvider.getTreeItem(element);
      projectProvider.refresh();
    }
    vscode.window.showInformationMessage(`已切换到项目: ${element.data.name}`);
  }
};

// ─────────────────────────────────────────────────────────────
// Provider instances (exported so extension.js can register them)
// ─────────────────────────────────────────────────────────────
const projectProvider = new RenesasProjectTreeDataProvider();
const buildModeProvider = new RenesasBuildModeTreeDataProvider();

module.exports = {
  // State
  globalMtpjConfig,
  currentProject,
  // Providers
  RenesasProjectTreeDataProvider,
  RenesasBuildModeTreeDataProvider,
  projectProvider,
  buildModeProvider,
  // Classes (exposed for instanceof checks)
  RenesasProjectItem,
  RenesasBuildModeItem,
  // Commands
  buildProject,
  refreshEntry,
  setCurrentProject,
  // API
  refreshAll,
  parseMtpjFile,
  findMtpjFiles,
};
