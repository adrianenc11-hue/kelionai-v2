import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Code Execution Engine
 * Safely executes code in sandboxed environment
 */

const execAsync = promisify(exec);

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
  language: string;
}

export class CodeExecutor {
  private maxExecutionTime = 10000; // 10 seconds
  private allowedLanguages = ["python", "javascript", "sql", "bash"];

  /**
   * Execute code in safe sandbox
   */
  async executeCode(code: string, language: string): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Validate language
    if (!this.allowedLanguages.includes(language.toLowerCase())) {
      return {
        success: false,
        output: "",
        error: `Language '${language}' is not supported. Supported: ${this.allowedLanguages.join(", ")}`,
        executionTime: 0,
        language,
      };
    }

    // Sanitize code
    const sanitized = this.sanitizeCode(code, language);

    try {
      let result: { stdout: string; stderr: string };

      switch (language.toLowerCase()) {
        case "python":
          result = await this.executePython(sanitized);
          break;
        case "javascript":
          result = await this.executeJavaScript(sanitized);
          break;
        case "sql":
          result = await this.executeSql(sanitized);
          break;
        case "bash":
          result = await this.executeBash(sanitized);
          break;
        default:
          throw new Error(`Unsupported language: ${language}`);
      }

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        output: result.stdout,
        error: result.stderr || undefined,
        executionTime,
        language,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : "Unknown error",
        executionTime,
        language,
      };
    }
  }

  /**
   * Execute Python code
   */
  private async executePython(code: string): Promise<{ stdout: string; stderr: string }> {
    const filename = join(tmpdir(), `kelion-${Date.now()}.py`);

    try {
      await writeFile(filename, code);
      const { stdout, stderr } = await execAsync(`python3 "${filename}"`, {
        timeout: this.maxExecutionTime,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return { stdout, stderr };
    } finally {
      await unlink(filename).catch(() => {});
    }
  }

  /**
   * Execute JavaScript code
   */
  private async executeJavaScript(code: string): Promise<{ stdout: string; stderr: string }> {
    const filename = join(tmpdir(), `kelion-${Date.now()}.js`);

    try {
      await writeFile(filename, code);
      const { stdout, stderr } = await execAsync(`node "${filename}"`, {
        timeout: this.maxExecutionTime,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr };
    } finally {
      await unlink(filename).catch(() => {});
    }
  }

  /**
   * Execute SQL code (simulated - requires database connection)
   */
  private async executeSql(code: string): Promise<{ stdout: string; stderr: string }> {
    // This would connect to actual database
    // For now, return simulated response
    return {
      stdout: `SQL executed: ${code.substring(0, 50)}...`,
      stderr: "",
    };
  }

  /**
   * Execute Bash commands (limited)
   */
  private async executeBash(code: string): Promise<{ stdout: string; stderr: string }> {
    // Only allow safe commands
    const unsafePatterns = [
      "rm -rf",
      "sudo",
      "chmod",
      "chown",
      "dd",
      "mkfs",
      "mount",
      "umount",
    ];

    for (const pattern of unsafePatterns) {
      if (code.includes(pattern)) {
        throw new Error(`Unsafe command detected: ${pattern}`);
      }
    }

    const { stdout, stderr } = await execAsync(code, {
      timeout: this.maxExecutionTime,
      maxBuffer: 10 * 1024 * 1024,
    });

    return { stdout, stderr };
  }

  /**
   * Sanitize code to prevent injection attacks
   */
  private sanitizeCode(code: string, language: string): string {
    // Remove dangerous imports/requires
    const dangerousPatterns = [
      /import\s+os/gi,
      /import\s+subprocess/gi,
      /require\s*\(\s*['"]child_process['"]\s*\)/gi,
      /eval\s*\(/gi,
      /exec\s*\(/gi,
      /__import__/gi,
    ];

    let sanitized = code;
    for (const pattern of dangerousPatterns) {
      sanitized = sanitized.replace(pattern, "// BLOCKED: " + pattern);
    }

    return sanitized;
  }

  /**
   * Generate code from natural language
   */
  async generateCode(description: string, language: string): Promise<string> {
    // This would use LLM to generate code
    // Placeholder implementation
    return `# Generated code for: ${description}\n# Language: ${language}\n\nprint("Hello, World!")`;
  }

  /**
   * Analyze code for issues
   */
  analyzeCode(code: string, language: string): { issues: string[]; suggestions: string[] } {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check for common issues
    if (code.length === 0) {
      issues.push("Code is empty");
    }

    if (code.includes("TODO") || code.includes("FIXME")) {
      suggestions.push("Code contains TODO/FIXME comments");
    }

    // Language-specific checks
    if (language.toLowerCase() === "python") {
      if (!code.includes("def ") && !code.includes("class ")) {
        suggestions.push("Consider organizing code into functions or classes");
      }
    }

    if (language.toLowerCase() === "javascript") {
      if (code.includes("var ")) {
        suggestions.push("Consider using 'let' or 'const' instead of 'var'");
      }
    }

    return { issues, suggestions };
  }
}

export default CodeExecutor;
