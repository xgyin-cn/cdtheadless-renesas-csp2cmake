// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
const TreeDataProvider = require("./data-views/nodeDependencies");
const search_file = require("./src/search_file");

// ── Renesas CSP2CMake ──────────────────────────────────────
const renesasMtpj = require("./data-views/renesas-mtpj");
const {setContext} = require('./data-views/renesas-cli-parse')
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log(
		'Congratulations, your extension "cdtheadlessbuild" is now active!'
	);
	setContext(context);
	// ── Eclipse CDT (existing) ──────────────────────────────
	search_file.getProjectConfig();

	const nodeDependencies = new TreeDataProvider.MyTreeDataProvider();
	vscode.window.registerTreeDataProvider(
		"SearchedProjectTree",
		nodeDependencies,
	);
	vscode.commands.registerCommand("SearchedProjectTree.refreshEntry", () =>
		nodeDependencies.refresh(),
	);
	vscode.commands.registerCommand(
		"SearchedProjectTree.buildProject",
		TreeDataProvider.executeBuildCommand,
	);
	vscode.commands.registerCommand(
		"SearchedProjectTree.buildAllProject",
		(element) => {
			vscode.window.showInformationMessage(
				"buildAllProject is wating implementation",
			);
			console.log(element);
		},
	);
	nodeDependencies.refresh();

	// ── Renesas CSP2CMake ────────────────────────────────────
	const {
		projectProvider,
		buildModeProvider,
		buildProject,
		refreshEntry,
		setCurrentProject,
	} = renesasMtpj;

	// Register tree data providers
	vscode.window.registerTreeDataProvider(
		"RenesasCSP2CMakeConfig",
		projectProvider,
	);
	vscode.window.registerTreeDataProvider("RenesasCSP2CMake", buildModeProvider);

	// Register commands
	vscode.commands.registerCommand(
		"RenesasCSP2CMake.refreshEntry",
		refreshEntry,
	);
	vscode.commands.registerCommand(
		"RenesasCSP2CMake.buildProject",
		buildProject,
	);
	vscode.commands.registerCommand(
		"RenesasCSP2CMake.setCurrentProject",
		setCurrentProject,
	);

	// Initial scan on activation
	renesasMtpj
		.refreshAll()
		.catch((err) =>
			console.error("[Renesas CSP2CMake] Activation error:", err),
		);
}

// This method is called when your extension is deactivated
function deactivate() { }

module.exports = {
	activate,
	deactivate,
};
