import fs from "fs-extra";
import path from "path";
import { execSync } from "child_process";
import fetch from "node-fetch";
import AdmZip from "adm-zip";
import inquirer from "inquirer";
import chalk from "chalk";

const EXAMPLES_REPO_ZIP_URL =
  "https://github.com/modelence/examples/archive/refs/heads/main.zip";
const DEFAULT_TEMPLATE = "empty-project";

interface CreateAppOptions {
  template?: string;
}

// Custom error class to signal "user-facing" errors
class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

const displayModelenceHeader = () => {
  console.log(
    chalk.bold.hex("#5509D9")(`
   __  __           _      _                     
  |  \\/  |         | |    | |                    
  | \\  / | ___   __| | ___| | ___ _ __   ___ ___ 
  | |\\/| |/ _ \\ / _\` |/ _ \\ |/ _ \\ '_ \\ / __/ _ \\
  | |  | | (_) | (_| |  __/ |  __/ | | | (_|  __/
  |_|  |_|\\___/ \\__,_|\\___|_|\\___|_| |_|\\___\\___|
  `),
  );
  console.log(
    chalk.gray(
      "Production-ready by default with everything you need to go live\n",
    ),
  );
};

export async function createApp(
  projectName: string,
  options: CreateAppOptions = {},
) {
  try {
    await _createApp(projectName, options);
  } catch (error: any) {
    if (error.name === "ExitPromptError") {
      console.log(chalk.gray("\n  Cancelled."));
      process.exit(0);
    }

    //Show Customized Short One Line error
    if (error.name === "AppError") {
      console.log(chalk.red(`\n  Error: ${error.message}`));
      console.log();
      process.exit(1);
    }
    throw error;
  }
}

async function _createApp(projectName: string, options: CreateAppOptions = {}) {
  displayModelenceHeader();

  const templates = [
    { name: "Empty Project", value: "empty-project" },
    { name: "AI Chat App", value: "ai-chat" },
    { name: "Data API", value: "data-api" },
    { name: "Todo App", value: "todo-app" },
    { name: "Typesonic", value: "typesonic" },
  ];

  // If project name is not provided, ask for it
  if (!projectName) {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "projectName",
        message: "What is your project name?",
        default: "my-app",
      },
    ]);
    projectName = answers.projectName;
  }

  // Validate project name
  if (!/^[a-zA-Z0-9-_]+$/.test(projectName)) {
    throw new AppError(
      "Project name can only contain letters, numbers, dashes and underscores",
    );
  }

  // Check if directory already exists
  const projectPath = path.resolve(process.cwd(), projectName);
  if (fs.existsSync(projectPath)) {
    throw new AppError(`A Directory with name ${projectName} already exists.`);
  }

  let template = options.template?.trim() || undefined;

  const validTemplates = templates.map((t) => t.value);
  if (template && !validTemplates.includes(template)) {
    throw new AppError(`Template "${template}" not found.`);
  }

  if (!template) {
    const { template: selectedTemplate } = await inquirer.prompt([
      {
        type: "select",
        name: "template",
        message: "Which template would you like to use?",
        choices: templates,
      },
    ]);
    template = selectedTemplate;
  }

  // Fallback just in case
  if (!template) {
    template = DEFAULT_TEMPLATE;
  }

  console.log();
  console.log(
    chalk.cyan(`Creating new Modelence app: `) + chalk.bold(projectName),
  );
  console.log(chalk.cyan(`Using template: `) + chalk.bold(template));
  console.log();

  // Download and extract the examples repo
  const tempDir = path.resolve(
    process.cwd(),
    `.temp-modelence-examples-${Date.now()}`,
  );
  const zipPath = path.join(tempDir, "examples.zip");

  try {
    // Create temp directory
    fs.ensureDirSync(tempDir);

    const response = await fetch(EXAMPLES_REPO_ZIP_URL);
    if (!response.ok) {
      throw new AppError(`Failed to download examples: ${response.statusText}`);
    }

    // Save zip file
    const zipBuffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(zipPath, zipBuffer);

    // Extract zip
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);

    // Find the extracted directory (GitHub adds a folder name like "examples-main")
    const extractedDirs = fs
      .readdirSync(tempDir)
      .filter(
        (item) =>
          fs.statSync(path.join(tempDir, item)).isDirectory() &&
          item !== "__MACOSX",
      );

    if (extractedDirs.length === 0) {
      throw new AppError(`Template "${template}" not found.`);
    }

    const extractedRepoDir = path.join(tempDir, extractedDirs[0]);
    const templatePath = path.join(extractedRepoDir, template);

    //Handles error if template not found
    if (!fs.existsSync(templatePath)) {
      throw new AppError(`Template "${template}" not found.`);
    }

    // Copy template files to project directory
    fs.copySync(templatePath, projectPath);

    // Update package.json
    const packageJsonPath = path.join(projectPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      packageJson.name = projectName;
      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
    }

    // Install dependencies
    execSync("npm install", { cwd: projectPath, stdio: "inherit" });

    console.log(chalk.green(`\n  ✓ Successfully created ${projectName}!`));
    console.log(`\n  Get started by typing:\n`);
    console.log(chalk.cyan(`    cd ${projectName}`));
    console.log(chalk.cyan(`    npm run dev\n`));
  } catch (error: any) {
    // Clean up on error
    if (fs.existsSync(projectPath)) {
      fs.removeSync(projectPath);
    }

    throw error;
  } finally {
    // Always clean up temp dir whether success or error
    if (fs.existsSync(tempDir)) fs.removeSync(tempDir);
  }
}
