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

    const micro_type_class = classes.find(
      (cls) => cls.$.Guid === "096f2041-c115-4158-959e-885938314c77",
    );
    const micro_type = Object.assign({}, ...micro_type_class.Instance)
      .DeviceName[0];

    const matched_class = classes.find(
      (cls) => cls.$.Guid === "eb3b4b69-af1a-4dc1-b2bc-4b81a50fb2a4",
    );
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
  constructor(data, tooltipSuffix = "", haschildren = false) {
    if (haschildren) {
      super(data.name, Expanded);
    } else {
      super(data.name, NoCollapsed);
    }
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
  constructor(mode, projectName, haschildren = false) {
    if (haschildren) {
      super(mode.name, Expanded);
    } else {
      super(mode.name, NoCollapsed);
    }
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
  constructor(name, data, idx, current_buildMode, projectName) {
    super(name, Collapsed);
    this.data = data;
    this.name = name;
    this.contextValue = "sourceItem";
    this.idx = idx;
    this.currentBuildMode = current_buildMode;
    this.projectName = projectName;
    // this.tooltip = `Type: ${src.type}`;
    // this.description = src.type;
    this.iconPath = new vscode.ThemeIcon("gear");
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
          (m) => new RenesasBuildModeItem(m, element.data.name, true),
        );
        return items;
      }
      if (element instanceof RenesasBuildModeItem) {
        // Third level: source items of the current project
        const configers = globalMtpjConfig.find(
          (p) => p.name === element.projectName,
        );
        const data_dict = {
          C编译选项: [
            "989d6783-59a0-4525-8ee4-a067fda90fe2",
            "24e7db6c-6f3c-483e-b3af-c4be92050d3b",
          ],
          Asm编译选项: ["55f70bbd-5f8f-404f-854e-5da727c86621"],
          链接选项: ["82d7e767-9e1b-43e5-a62d-4a892fa42000"],
          输出选项: ["cd7ca0dd-4e03-43a0-b849-b72bd0bf0bd1"],
          Lib选项: ["625fdef6-79e0-476f-ae26-6cde275afb59"],
        };
        const instances = configers.matched_class.Instance;
        const buildMode_idx = configers.buildModes.filter(
          (i) => i.name === configers.currentBuildMode,
        )[0].index;
        function check_prj_type() {
          let instances = configers.matched_class.Instance;
          if (instances) {
            let gop = instances.filter(
              (i) => i.$?.Guid === "989d6783-59a0-4525-8ee4-a067fda90fe2",
            );
            let attr = "GeneralOptionOutput-" + buildMode_idx;
            let mode = gop[0][attr][0];
            if (mode === "LibraryFile") {
              return "lib";
            } else {
              return "exe";
            }
          }
        }

        function filter_data(data, guid) {
          return data.filter((d) => guid.find((i) => i === d.$?.Guid));
        }

        let mode = check_prj_type();
        if (mode === "exe") {
          return ["C编译选项", "Asm编译选项", "链接选项", "输出选项"].map(
            (m) =>
              new RenesasOptionClassItem(
                m,
                filter_data(instances, data_dict[m]),
                buildMode_idx,
                element.label,
                element.projectName,
              ),
          );
        } else if (mode === "lib") {
          return ["C编译选项", "Asm编译选项", "Lib选项"].map(
            (m) =>
              new RenesasOptionClassItem(
                m,
                filter_data(instances, data_dict[m]),
                buildMode_idx,
                element.label,
                element.projectName,
              ),
          );
        }
      }
      if (element instanceof RenesasOptionClassItem) {
        const configers = globalMtpjConfig.find(
          (p) => p.name === element.projectName,
        );
        return currentProjectParser.parseMtpjXmlObj(element);
      }
      return [];
    }
    // Root: return project list

    if (!currentProject) {
      return [];
    } else if (!(currentProject instanceof RenesasProjectItem)) {
      return [new RenesasProjectItem(currentProject, "", true)];
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
        result.push(new RenesasProjectItem(proj));
      }
      if (result.length === 1) {
        currentProject = result[0];
        if (projectProvider) projectProvider.refresh();
      }
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
  console.log(
    "[RenesasMtpj] Scanned projects:",
    globalMtpjConfig.map((p) => p.name),
  );

  // Auto-select first project if none selected
  if (!currentProject && globalMtpjConfig.length > 0) {
    globalMtpjConfig.sort((a, b) => a.name.localeCompare(b.name)); // sort alphabetically
    currentProject = globalMtpjConfig[0];
  }

  if (buildModeProvider) buildModeProvider.refresh();
  return globalMtpjConfig;
}

// ─────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────

/** Build the selected project using the current build mode */
const buildProject = (element) => {
  if (element instanceof RenesasBuildModeItem) {
    currentProject = globalMtpjConfig.filter(
      (p) => p.name === element.projectName,
    )[0];
    if (projectProvider) projectProvider.refresh();
  }
  const data = element;
  vscode.window.showInformationMessage(
    `[Renesas Build] ${data.projectName}.mtpj  Current Build Mode: ${data.label}`,
  );
  // TODO: wire up actual build command (CS+ headless invocation)
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
const setCurrentProject = (element) => {
  if (element instanceof RenesasProjectItem) {
    currentProject = element.data;
    currentProjectParser.parseMtpjXmlObj(currentProject);
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
