import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

let watcher: fs.FSWatcher | undefined;

interface FlutterAssetsConfig {
  assets_path: string | string[];
  output_path: string;
  filename: string;
  field_prefix?: string;
  classname?: string;
  ignore_comments?: boolean;
  package_name?: string;
}

export function activate(context: vscode.ExtensionContext) {
  let watchDisposable = vscode.commands.registerCommand('flutter-assets-generator.watchAssets', () => {
    startWatching();
  });

  let stopWatchDisposable = vscode.commands.registerCommand('flutter-assets-generator.stopWatch', () => {
    stopWatching();
  });

  let generateDisposable = vscode.commands.registerCommand('flutter-assets-generator.generate', () => {
    generateAssets();
  });

  context.subscriptions.push(watchDisposable);
  context.subscriptions.push(stopWatchDisposable);
  context.subscriptions.push(generateDisposable);
}

function startWatching() {
  if (watcher) {
    stopWatching();
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const pubspecPath = path.join(rootPath, 'pubspec.yaml');

  if (!fs.existsSync(pubspecPath)) {
    vscode.window.showErrorMessage('No pubspec.yaml found');
    return;
  }

  watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
    if (filename && filename.includes('assets')) {
      generateAssets();
    }
  });

  vscode.window.showInformationMessage('Flutter Assets: Watching for changes...');
}

function stopWatching() {
  if (watcher) {
    watcher.close();
    watcher = undefined;
    vscode.window.showInformationMessage('Flutter Assets: Stopped watching');
  }
}

function generateAssets() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const pubspecPath = path.join(rootPath, 'pubspec.yaml');

  try {
    const pubspecContent = fs.readFileSync(pubspecPath, 'utf8');
    const pubspec = yaml.load(pubspecContent) as any;
    const config = pubspec.flutter_assets as FlutterAssetsConfig;

    if (!config) {
      vscode.window.showErrorMessage('No flutter_assets configuration found in pubspec.yaml');
      return;
    }

    const assetsPaths = Array.isArray(config.assets_path) ? config.assets_path : [config.assets_path];
    const outputPath = path.join(rootPath, config.output_path);
    const filename = config.filename || 'assets.dart';
    const classname = config.classname || 'Assets';
    const fieldPrefix = config.field_prefix === undefined ? 'assets' : config.field_prefix;
    const packageName = config.package_name;

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    let assetPaths: string[] = [];
    for (const assetsPath of assetsPaths) {
      const fullAssetsPath = path.join(rootPath, assetsPath);
      if (fs.existsSync(fullAssetsPath)) {
        assetPaths = assetPaths.concat(getAllFiles(fullAssetsPath));
      }
    }

    let output = '// ignore_for_file: prefer_single_quotes\n\n';
    output += `class ${classname} {\n`;
    output += `  ${classname}._();\n\n`;

    for (const assetPath of assetPaths) {
      const relativePath = path.relative(rootPath, assetPath).replace(/\\/g, '/');
      const variableName = generateVariableName(relativePath, fieldPrefix);
      const packagePath = packageName ? `packages/${packageName}/${relativePath}` : relativePath;

      if (!config.ignore_comments) {
        output += `  /// Assets for ${variableName}\\n`;
        output += `  /// ${packagePath}\n`;
      }
      output += `  static const String ${variableName} = "${packagePath}";\n\n`;
    }

    output += '}\n';

    fs.writeFileSync(path.join(outputPath, filename), output);
    vscode.window.showInformationMessage('Flutter Assets: Generated successfully');
  } catch (error) {
    vscode.window.showErrorMessage('Error generating assets: ' + error);
  }
}

const IGNORED_FILES = ['.DS_Store', 'Thumbs.db', '.gitkeep'];

function getAllFiles(dirPath: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_FILES.includes(entry.name)) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function toCamelCase(str: string): string {
  return str
    .split(/[_\-\.]+/)
    .filter(p => p.length > 0)
    .map((part, i) => {
      if (/^[0-9]+$/.test(part)) {
        return part;
      }
      if (i > 0 && /^[A-Z]+$/.test(part)) {
        return part;
      }
      if (i === 0) {
        return part.toLowerCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

function generateVariableName(relativePath: string, prefix: string): string {
  let namePath = relativePath;

  if (prefix) {
    const prefixDir = prefix.endsWith('/') ? prefix : prefix + '/';
    if (namePath.startsWith(prefixDir)) {
      namePath = namePath.substring(prefixDir.length);
    }
  }

  const lastDot = namePath.lastIndexOf('.');
  if (lastDot > 0) {
    namePath = namePath.substring(0, lastDot);
  }

  const parts = namePath.split('/').filter(p => p.length > 0);
  const camelParts = parts.map((part, i) => {
    const camel = toCamelCase(part);
    if (i === 0) {
      return camel;
    }
    return camel.charAt(0).toUpperCase() + camel.slice(1);
  });

  return camelParts.join('');
}

export function deactivate() {
  stopWatching();
}
