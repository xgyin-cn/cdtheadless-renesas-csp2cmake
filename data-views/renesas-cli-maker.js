const ejs = require("ejs");
const cli_parser_rules = require("./cli_command_format.json");

class RenesasCliOption {
    constructor(key, data) {
        this.key = key;// this is the name of the option
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
            console.log("Error in format string for FORMAT", this.key, this.format, this.description);
        }
        try {
            this.compiled_switch = ejs.compile(this.switch);
        } catch (error) {
            this.compiled_switch = false;
            console.log("Error in format string for SWITCH ", this.key, this.switch, this.description);
        }
    }

    input(arg, value) {
        if (!this.args.includes(arg)) {
            throw new Error(
                "Invalid argument in input options " + arg + " for " + this.format,
            );

        }
        if (this.args_valid != undefined) {
            let args = this.args_valid[arg];
            if (args && !args.includes(value)) {
                throw new Error(
                    "Invalid argument value in input options " + arg + " for invaild value " + value + " for " + this.format,
                );
            }
        }

        let obj = {};
        obj[arg] = value;
        this.input_args.push(obj);

    }
    clear() {
        this.input_args = [];
    }

    switchCheck() {
        let input_args = Object.assign({}, ...this.input_args);
        if (this.compiled_switch && this.input_args.length > 0) {
            let res = this.compiled_switch(input_args);
            return res === "true";
        }
        return false;
    }

    requiredCheck() {
        function isNonEmpty(value) {
            if (Array.isArray(value)) {
                return value.length > 0;
            }
            if (value && typeof value === 'object' && value.constructor === Object) {
                return Object.keys(value).length > 0;
            }
            return false;
        }
        // console.log(this.required, this.required != [] || this.required != {});
        if (isNonEmpty(this.required)) {
            return this.required;
        }

        return true;
    }

    compileOptionOutputCli() {
        this.final_args = Object.assign({}, ...this.input_args);
        if (this.compiled_format && this.args_valid != undefined) {
            while (this.args.map((item) => this.final_args[item] in this.args_valid).some(Boolean)) {
                for (const key of this.args) {
                    if (this.final_args[key] in this.args_valid) {
                        this.final_args[key] = this.args_valid[this.final_args[key]];
                    }
                }
            }
        }
        for (const key of this.args) {
            if (!(typeof this.final_args[key] === "boolean") && !(this.final_args[key] instanceof Array)) {
                try {
                    this.final_args[key] = ejs.render(this.final_args[key], this.final_args);
                } catch (error) {
                    console.log("Error in format string for ", this.key, key, this.final_args[key], " for ", this.final_args);
                }
            }
        }
        if (this.compiled_format) {
            return this.compiled_format(this.final_args);
        }
        throw new Error("No compiled format string in " + this.description + this.format);
    }
}

class RenesasCliMaker {
    constructor(rules) {
        this.options = new Map(
            Object.entries(rules).map(([key, value]) => [
                key,
                new RenesasCliOption(key, value),
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

    clear() {
        this.activet_options = [];
        for (const [key, value] of this.options) {
            value.clear();
        }
    }

    fpu_flag() {
        try{
            const fpu_config = this.options.get('-Xfloat');
            const round_config = this.options.get('-Xround');
            const dbl_size = this.options.get('-Xdbl_size');

            const fpu_flag = (() => { if (fpu_config.switchCheck() && this.access_required(fpu_config.requiredCheck())) return Object.assign({}, ...fpu_config.input_args)['value']; else return 'none'; })();
            const round_flag = round_config.switchCheck() && this.access_required(round_config.requiredCheck());
            const dbl_size_flag = dbl_size.switchCheck() && this.access_required(dbl_size.requiredCheck());
            console.log(fpu_flag, round_flag, dbl_size_flag);

            return `rh${fpu_flag === 'none' || fpu_flag === 'soft' ? 's' : 'f'}${dbl_size_flag ? '4' : '8'}${round_flag ? 'z' : 'n'}`
        }
        catch(error){
            return ''
        }
    }
    access_required(required_req,max_ver,min_ver) {
        if(max_ver)
        {
            if (this.versionCompare(max_ver) > 0) return false;
        }
        if(min_ver)
        {
            if (this.versionCompare(min_ver) < 0) return false;
        }
        if (required_req === true) return true;
        // console.log("required_req", required_req);
        if (required_req instanceof Array) {
            return required_req.map((item) => {
                let res = true;
                if (item === undefined) return res;

                for (const key of Object.keys(item))
                    if (this.options.has(key)) {
                        Object.entries(Object.assign({}, ...this.options.get(key).input_args)).forEach(
                            ([_key, _value]) => {
                                if (item[key][_key] instanceof Array)
                                    res = res && item[key][_key].includes(_value);
                                else if (item[key][_key] === _value)
                                    res = res && true;
                                else res = res && false;
                            }
                        )
                    }
                return res;
            }).some(Boolean);
        }
        else {
            let res = true;
            for (const key of Object.keys(required_req)) {
                if (this.options.has(key)) {
                    Object.entries(Object.assign({}, ...this.options.get(key).input_args)).forEach(
                        ([_key, _value]) => {
                            if (required_req[key][_key] instanceof Array)
                                res = res && required_req[key][_key].includes(_value);
                            else if (required_req[key][_key] === _value)
                                res = res && true;
                            else res = res && false;
                        }
                    )
                }
            }
            return res;
        }
    }

    filter_options() {
        for (const [key, value] of this.options) {
            // console.log(key, value.switchCheck(), this.access_required(value.requiredCheck()));
            if (value.switchCheck() && this.access_required(value.requiredCheck(),value.maxVersion,value.minVersion)) {
                this.activet_options.push(key);
            }
        }
    }

    setVersion(version) {
        this.version = version;
    }

    versionCompare(version) {
        let version1 = this.version.replace('V','').split('.').map(Number);
        let version2 = version.replace('V','').split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if (version1[i] > version2[i]) return 1;
            else if (version1[i] < version2[i]) return -1;
        } 
        return 0;
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
