const vscode = require("vscode");
const xml2js = require("xml2js");
const fs = require("fs");
const path = require("path");
const mtpj2cli = require("./mtpj2cli_parse.json");
const cli_maker = require("./renesas-cli-maker");

const cli_maker_map = cli_maker.cli_maker;
const Collapsed = vscode.TreeItemCollapsibleState.Collapsed;
const Expanded = vscode.TreeItemCollapsibleState.Expanded;
const NoCollapsed = vscode.TreeItemCollapsibleState.None;

function replaceVars(str, variables) {
  return str.replace(/%([^%]+)%/g, (match, varName) => {
    return variables[varName] !== undefined ? variables[varName] : match;
  });
}

class RenesasOptionItem extends vscode.TreeItem {
  /**
   * @param {object} src  { guid, type }
   */
  constructor(name, is_setting, description) {
    super(name, NoCollapsed);
    this.name = name;
    this.contextValue = "optionItem";
    this.tooltip = `${description}`;
    if (is_setting) {
      this.iconPath = new vscode.ThemeIcon("pass");
    } else {
      this.iconPath = new vscode.ThemeIcon("error");
    }
  }
}

class RenesasOptionFilter {
  constructor(type) {
    this.rules = mtpj2cli;
    this.type = type;
    this.map = {
      C编译选项: "Compile",
      Asm编译选项: "Assemble",
      链接选项: "Link",
      输出选项: "Hexoutput",
      Lib选项: "Library",
    };
  }
  matchOption(option, xml, idx, env) {
    const options = this.rules[this.map[this.type]];
    const keys = Object.keys(options);
    for (const key of keys) {
      let option_value = {};

      const op = key + "-" + idx;
      if (xml[op] !== undefined) {
        const value = xml[op];
        const rule = options[key];
        if (rule.type === "boolean") {
          if (value[0] === "True") {
            option_value[rule.arg] = true;
          } else {
            option_value[rule.arg] = false;
          }
        } else if (rule.type === "string") {
          if (rule.rule === "lowercase") {
            option_value[rule.arg] = value[0].toLowerCase();
          } else option_value[rule.arg] = value[0];
        } else if (rule.type === "list") {
          option_value[rule.arg] = value[0].split("\r");
        } else if (rule.type === "string-env") {
          option_value[rule.arg] = replaceVars(value[0], env);
        }
      }
      option.set(options[key].cli_option, option_value);
    }
    console.log(option);
    option.filter_options();
  }
}

class RenesasMtpjParser {
  constructor() {
    this.projectTypeMap = {
      lib: ["C编译选项", "Asm编译选项", "Lib选项"],
      exe: ["C编译选项", "Asm编译选项", "链接选项", "输出选项"],
    };
    this.cli_maker = cli_maker_map;
    this.data_dict = {
      C编译选项: [
        "989d6783-59a0-4525-8ee4-a067fda90fe2",
        "24e7db6c-6f3c-483e-b3af-c4be92050d3b",
      ],
      Asm编译选项: ["55f70bbd-5f8f-404f-854e-5da727c86621"],
      链接选项: ["82d7e767-9e1b-43e5-a62d-4a892fa42000"],
      输出选项: ["cd7ca0dd-4e03-43a0-b849-b72bd0bf0bd1"],
      Lib选项: ["625fdef6-79e0-476f-ae26-6cde275afb59"],
    };
  }
  setEnv(data) {
    const configers = ""//vscode.workspace.getConfiguration("renesas");
    const microToolPath = ""//configers.get("microToolPath");
    const system_env = process.env;
    this.env = {};
    this.env["ActiveProjectDir"] = path.dirname(data.filePath);
    this.env["ActiveProjectMicomName"] = data.micro_type;
    this.env["ActiveProjectName"] = data.projectName;
    this.env["BuildModeName"] = data.currentBuildMode;
    this.env["MainProjectDir"] = path.dirname(data.filePath);
    this.env["MainProjectMicomName"] = data.micro_type;
    this.env["MainProjectName"] = data.projectName;
    this.env["MicomToolPath"] = microToolPath;
    this.env["ProjectDir"] = path.dirname(data.filePath);
    this.env["ProjectMicomName"] = data.micro_type;
    this.env["ProjectName"] = data.projectName;
    this.env["TempDir"] = system_env.TEMP;
    this.env["WinDir"] = system_env.SystemRoot + "\\system32";

    Object.assign(this.env, system_env);
  }
  parseMtpjXmlObj(data) {
    this.data = data;
    this.setEnv(data);
    this.currentBuildModeIndex = data.currentBuildModeIndex;
    function filter_data(data, guid) {
      return data.filter((d) => guid.find((i) => i === d.$?.Guid));
    }

    this.projectTypeMap[data.projectType].map((item) => {
      new RenesasOptionFilter(item).matchOption(
        this.cli_maker[item],
        Object.assign(
          {},
          ...filter_data(data.matched_class.Instance, this.data_dict[item]),
        ),
        this.currentBuildModeIndex,
        this.env,
      );
    });
  }
}

module.exports = {
  RenesasMtpjParser,
};
