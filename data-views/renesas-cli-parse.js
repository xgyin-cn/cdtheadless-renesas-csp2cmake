const vscode = require("vscode");
// const xml2js = require("xml2js");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const mtpj2cli = require("./mtpj2cli_parse.json");
const cli_maker = require("./renesas-cli-maker");

const cli_maker_map = cli_maker.cli_maker;
// const Collapsed = vscode.TreeItemCollapsibleState.Collapsed;
// const Expanded = vscode.TreeItemCollapsibleState.Expanded;
// const NoCollapsed = vscode.TreeItemCollapsibleState.None;

let extensionContext = null;

function setContext(context) {
  extensionContext = context;
}
function getContext() {
  return extensionContext;
}


function replaceVars(str, variables) {
  return str.replace("\n", "").replace(/%([^%]+)%/g, (match, varName) => {
    return variables[varName] !== undefined ? variables[varName] : match;
  });
}

// class RenesasOptionItem extends vscode.TreeItem {
//   /**
//    * @param {object} src  { guid, type }
//    */
//   constructor(name, is_setting, description) {
//     super(name, NoCollapsed);
//     this.name = name;
//     this.contextValue = "optionItem";
//     this.tooltip = `${description}`;
//     if (is_setting) {
//       this.iconPath = new vscode.ThemeIcon("pass");
//     } else {
//       this.iconPath = new vscode.ThemeIcon("error");
//     }
//   }
// }

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
            option_value[rule.arg] = replaceVars(value[0].toLowerCase(), env);
          } else option_value[rule.arg] = replaceVars(value[0], env);
        } else if (rule.type === "list") {
          option_value[rule.arg] = value[0]
            .replaceAll("\\", "/")
            .split("\r")
            .map((x) => replaceVars(x, env));
        } else if (rule.type === "string-env") {
          option_value[rule.arg] = replaceVars(value[0], env).replaceAll("\\", "/");
        }
      }
      // console.log(key,option_value);
      option.set(options[key].cli_option, option_value);
    }
    // console.log(option);
    return option;
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
    const configers = vscode.workspace.getConfiguration("renesas");
    let microToolPath = "";
    if (configers) {
      microToolPath = configers.get("ccrh_toolchain_path");
    }
    const system_env = process.env;
    this.env = {};
    this.env["ActiveProjectDir"] = path.dirname(data.filePath).replaceAll("\\", "/");
    this.env["ActiveProjectMicomName"] = data.micro_type;
    this.env["ActiveProjectName"] = data.projectName;
    this.env["BuildModeName"] = data.currentBuildMode;
    this.env["MainProjectDir"] = path.dirname(data.filePath).replaceAll("\\", "/");
    this.env["MainProjectMicomName"] = data.micro_type;
    this.env["MainProjectName"] = data.projectName;
    this.env["MicomToolPath"] = microToolPath;
    this.env["ProjectDir"] = path.dirname(data.filePath).replaceAll("\\", "/");
    this.env["ProjectMicomName"] = data.micro_type;
    this.env["ProjectName"] = data.projectName;
    this.env["TempDir"] = system_env.TEMP;
    this.env["WinDir"] = system_env.SystemRoot + "\\system32";
    this.env["ResetVectorPE1"] = "0"; //data.resetVectorPE1;
    Object.assign(this.env, system_env);
  }

  clear() {
    for (const value of Object.values(this.cli_maker)) {
      value.clear();
    }
  }

  parseMtpjXmlObj(data) {
    this.data = data;
    this.clear();
    this.setEnv(data);
    this.currentBuildModeIndex = data.currentBuildModeIndex;
    this.projectType = data.projectType;
    function filter_data(data, guid) {
      return data.filter((d) => guid.find((i) => i === d.$?.Guid));
    }
    this.option_filted = [];

    for (const item of this.projectTypeMap[data.projectType]) {
      this.option_filted.push(
        new RenesasOptionFilter(item).matchOption(
          this.cli_maker[item],
          Object.assign(
            {},
            ...filter_data(data.matched_class.Instance, this.data_dict[item]),
          ),
          this.currentBuildModeIndex,
          this.env,
        ),
      );
    }
    const configers = vscode.workspace.getConfiguration("renesas");
    configers.update(
      "ccrh_toolchain_path",
      path.normalize(
        Object.assign({}, ...this.cli_maker["C编译选项"].get("-V").input_args)[
        "path"
        ][1] + "../../../",
      ),
    );

    this.version = Object.assign({}, ...this.cli_maker["C编译选项"].options.get("-V").input_args)["version"];
    for (const item of this.projectTypeMap[data.projectType]) {
      this.cli_maker[item].setVersion(this.version);
    }
    for (const item of this.option_filted) {
      item.filter_options();
    }
  }

  async generateCmakeCli() {
    const float_mode = this.cli_maker["C编译选项"].fpu_flag();
    const ccrh_toolchain_path = path.normalize(
      Object.assign({}, ...this.cli_maker["C编译选项"].get("-V").input_args)[
      "path"
      ][1] + "/bin",
    ).replaceAll("\\", "/");
    const options = {
      C编译选项: [],
      Asm编译选项: [],
      链接选项: [],
      输出选项: [],
      Lib选项: [],
    };

    for (const item of this.projectTypeMap[this.projectType]) {
      for (const key of this.cli_maker[item].activet_options) {
        const value = this.cli_maker[item].options.get(key);
        if (item === "C编译选项" && key === "-I") continue;
        if (item === "Asm编译选项" && key === "-I") continue;
        options[item].push(value.compileOptionOutputCli());
      }
    }
    const csp_prj_root_path = this.env["ActiveProjectDir"];
    const c_compiler_options = options["C编译选项"].join(" ");
    const asm_compiler_options = options["Asm编译选项"].join(" ");
    const link_options = options["链接选项"].join(" ");
    const output_options = options["输出选项"].join(" ");
    const lib_options = options["Lib选项"].join(" ");
    const include_path_list = Object.assign(
      {},
      ...this.cli_maker["C编译选项"].options.get("-I").input_args,
    )["dir"];
    let include_path = "";
    if (include_path_list.length === 0) {
      include_path = "";
    } else {
      include_path = "    ${CSP_PROJECT_ROOT_PATH}/" + include_path_list.map((item) => item.replaceAll("\\", "/")).join("\n    ${CSP_PROJECT_ROOT_PATH}/");;
      // include_path =
      //   "    ${CMAKE_SOURCE_DIR}/" +
      //   include_path_list.join("\n    ${CMAKE_SOURCE_DIR}/");
    }

    // const prj_class_data = Object.assign({},...this.data.matched_class.Instance);

    const all_files_with_times = {};
    Object.keys(this.data.excute_files).map((key) => {
      const file_data = this.data.matched_class.Instance.find((item) => item.$.Guid === key);
      all_files_with_times[file_data.ItemAddTime[0]] = Object.assign([], { [parseInt(file_data.ItemAddTimeCount[0])]: key }, (all_files_with_times[file_data.ItemAddTime[0]] || []));
    });


    const all_files_with_name = [];
    Object.keys(all_files_with_times).sort().map((key) => {
      for (let index = 0; index < all_files_with_times[key].length; index++) {
        const element = all_files_with_times[key][index];
        if (element != undefined && (element.length ?? 0) == 36) {
          all_files_with_name.push(this.data.file_tree.files[element]);
        }
        else if (element != undefined) {
          console.debug("文件guid异常", element, "对应的添加时间为", key);
        }
      }
    })
    const all_files = "    ${CSP_PROJECT_ROOT_PATH}/" + all_files_with_name.map((item) => item.replaceAll("\\", "/")).join("\n    ${CSP_PROJECT_ROOT_PATH}/");
    const asm_files = "    ${CSP_PROJECT_ROOT_PATH}/" + Object.values(this.data.file_tree.files).map((item) => item.replaceAll("\\", "/")).filter((item) => item.endsWith(".asm")).join("\n    ${CSP_PROJECT_ROOT_PATH}/");

    const ejs_value = {
      csp_prj_root_path,
      c_compiler_options,
      asm_compiler_options,
      link_options,
      output_options,
      lib_options,
      include_path,
      ccrh_toolchain_path,
      float_mode,
      all_files,
      asm_files
    };
    const root = getContext().extensionPath;
    const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;

    const file_list = [
      "CMakeLists.txt",
      "cmake/cross.cmake",
      "cmake/Config.cmake",
      "cmake/GeneratedCfg.cmake",
      "cmake/GeneratedSrc.cmake",
    ];

    for (const file of file_list) {
      fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
      const read_template = fs.readFileSync(
        path.join(root, "data-views", "template", file),
        "utf-8")

      if (read_template) {
        const write_template = ejs.render(read_template, ejs_value);
        // console.log(write_template);
        fs.writeFileSync(path.join(workspace, file), write_template);
      }
    }

    const configers = vscode.workspace.getConfiguration("cmake");
    configers.update("configureSettings", {
      "CMAKE_TOOLCHAIN_FILE": "${workspaceFolder}/cmake/cross.cmake",
      "CMAKE_TOOLS_FOLDER": "${command:renesas.utilities.folder}/tools",
    })
    configers.update("sourceDirectory", "${workspaceFolder}");
    configers.update("preferredGenerators", [
      "Ninja",
      "MinGW Makefiles",
      "Unix Makefiles"
    ]);
    configers.update("configureOnOpen", true);

    const cmake_extension = vscode.extensions.getExtension('twxs.cmake')
    
    if (cmake_extension && !cmake_extension.isActive) {
      await cmake_extension.activate();
    }
    try {
      await vscode.commands.executeCommand("cmake.cleanConfigure");
      await vscode.commands.executeCommand("cmake.build");
    }catch (error) {
      console.log(error);
    }

  }
}

module.exports = {
  RenesasMtpjParser,
  setContext,
  getContext,
};
