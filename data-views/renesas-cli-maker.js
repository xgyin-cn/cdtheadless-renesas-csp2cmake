const ejs = require("ejs");
const cli_parser_rules = require("./cli_command_format.json");

class RenesasCliOption {
  constructor(data) {
    this.description = data.description;
    this.type = data.type;
    this.required = data.required;
    this.minVersion = data.minVersion;
    this.args = data.args;
    this.format = data.format;
    this.PEonly = data.PEonly;
    this.maxVersion = data.maxVersion;
    this.switch = data.switch;
    this.args_valid = data.args_valid;
    this.args_list_join = data.args_list_join;
    // this.compiledFormatString();
    this.input_args = [];

    try {
      this.compiled_format = ejs.compile(this.format);
    } catch (error) {
      this.compiled_format = false;
    }
    try {
      this.compiled_switch = ejs.compile(this.switch);
    } catch (error) {
      this.compiled_switch = false;
    }
  }

  input(arg, value) {
    if (this.args.includes(arg)) {
      let obj = {};
      obj[arg] = value;
      this.input_args.push(obj);
    } else throw new Error("Invalid argument");
  }

  switchCheck() {
    let input_args = Object.assign({}, ...this.input_args);
    if (this.compiled_switch && this.input_args.length > 0) {
      let res = this.compiled_switch(input_args);
      return Boolean(res);
    }
  }
}

class RenesasCliMaker {
  constructor(rules) {
    this.options = new Map(
      Object.entries(rules).map(([key, value]) => [
        key,
        new RenesasCliOption(value),
      ]),
    );
    this.activet_options = []; // 保存激活的选项
  }
  set(cli_name, option_value) {
    if (cli_name instanceof Array) {
      for (const name of cli_name) {
        const option = this.get(name);
        if (option)
          Object.entries(option_value).forEach(([key, value]) =>
            option.input(key, value),
          );
        else console.log(`No such option: ${name}`);
      }
    } else {
      const option = this.get(cli_name);
      if (option)
        Object.entries(option_value).forEach(([key, value]) =>
          option.input(key, value),
        );
      else console.log(`No such option: ${cli_name}`);
    }
  }
  get(cli_name) {
    return this.options.get(cli_name);
  }
  filter_options() {
    for (const [key, value] of this.options) {
      if (value.switchCheck()) this.activet_options.push(key);
    }
  }
}

const cli_maker = {
  C编译选项: new RenesasCliMaker(cli_parser_rules.CompileOptions),
  Asm编译选项: new RenesasCliMaker(cli_parser_rules.CompileOptions),
  链接选项: new RenesasCliMaker(cli_parser_rules.LinkOptions),
  输出选项: new RenesasCliMaker(cli_parser_rules.HexoutputOptions),
  Lib选项: new RenesasCliMaker(cli_parser_rules.LinkOptions),
};

module.exports = {
  cli_maker,
};
