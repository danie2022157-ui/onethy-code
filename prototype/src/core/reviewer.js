import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveCanonicalPath } from './security.js';

/**
 * Módulo de Revisão Real de Código e Auditoria de Segurança do OmniCode
 * Executa varredura estática de vulnerabilidades e aciona o agente Revisor (LLM) com evidências reais.
 */
export class CodeReviewer {
  constructor({ workspaceDir, router, provider }) {
    this.workspaceDir = workspaceDir;
    this.router = router;
    this.provider = provider;
  }

  /**
   * Executa a auditoria completa de arquivos reais
   * @param {string} [targetPath] - Subpasta ou arquivo específico (opcional)
   * @returns {Promise<{ success: boolean, report: string, findings: Array, filesChecked: number }>}
   */
  async review(targetPath = '') {
    const root = targetPath ? resolveCanonicalPath(this.workspaceDir, targetPath) : this.workspaceDir;
    const fileList = await this.collectFiles(root);

    if (fileList.length === 0) {
      return {
        success: true,
        report: 'Nenhum arquivo de código encontrado no workspace para revisão.',
        findings: [],
        filesChecked: 0
      };
    }

    // 1. Análise Estática Real (Segredos, Chamadas Perigosas, Práticas Inseguras)
    const staticFindings = [];
    const fileContents = [];
    let totalLines = 0;

    for (const file of fileList) {
      try {
        const content = await fs.readFile(file.fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        totalLines += lines.length;

        fileContents.push({
          relPath: file.relPath,
          linesCount: lines.length,
          snippet: content.slice(0, 4000) // Amostra de contexto
        });

        // Varredura de credenciais e segredos vazados
        lines.forEach((line, idx) => {
          if (/(api[_-]?key|secret|password|bearer|auth[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{8,}['"]/i.test(line)) {
            staticFindings.push({
              file: file.relPath,
              line: idx + 1,
              severity: 'CRÍTICA',
              type: 'Exposição de Credencial',
              message: 'Possível chave de API ou segredo hardcoded no código.'
            });
          }

          // Varredura de injeção ou execução insegura
          if (/\beval\s*\(|new\s+Function\s*\(|\bexec\s*\([^,)]*\+/i.test(line)) {
            staticFindings.push({
              file: file.relPath,
              line: idx + 1,
              severity: 'ALTA',
              type: 'Execução Dinâmica Insegura',
              message: 'Uso de eval(), new Function() ou concatenação dinâmica em shell exec.'
            });
          }
        });
      } catch (err) {
        // Ignora binários ou arquivos inacessíveis
      }
    }

    // 2. Se houver modelo LLM configurado, executa auditoria semântica profunda
    const configuredModels = this.router ? this.router.getAllModels().filter((m) => m.isConfigured) : [];
    let llmAnalysis = '';

    if (configuredModels.length > 0 && this.provider && !this.provider.simulationMode) {
      try {
        const reviewerModel = this.router.selectModelForAgent(
          { id: 'reviewer', role: 'Security & QA Auditor', preferred_model_criteria: { strengths: ['code-review', 'security'] } },
          'code-review'
        );

        const prompt = `Você é o Auditor Sênior de Qualidade e Segurança de Código do OmniCode.
Analise os arquivos abaixo e aponte apenas problemas reais e verificáveis (bugs lógicos, falhas de concorrência, brechas de segurança ou tratamento inadequado de erros).
Seja estrito, técnico e sem elogios vazios. Se houver falhas, cite o arquivo e o trecho com a correção recomendada.

Arquivos auditados:
${fileContents.map((f) => `### Arquivo: ${f.relPath} (${f.linesCount} linhas)\n\`\`\`\n${f.snippet}\n\`\`\``).join('\n\n')}`;

        const response = await this.provider.call({
          modelId: reviewerModel,
          messages: [
            { role: 'system', content: 'Você é um auditor rigoroso de código. Forneça análise estruturada baseada estritamente no código inspecionado.' },
            { role: 'user', content: prompt }
          ]
        });

        llmAnalysis = response.content || '';
      } catch (err) {
        llmAnalysis = `(Falha ao consultar LLM do revisor: ${err.message})`;
      }
    }

    // 3. Monta o relatório com evidências reais
    let report = `## 📋 Relatório de Auditoria e Revisão Real (OmniCode)\n\n`;
    report += `- **Arquivos Auditados (${fileList.length})**: ${fileList.map((f) => f.relPath).join(', ')}\n`;
    report += `- **Total de Linhas Analisadas**: ${totalLines.toLocaleString()}\n`;
    report += `- **Vulnerabilidades Estáticas Detectadas**: ${staticFindings.length}\n\n`;

    if (staticFindings.length > 0) {
      report += `### ⚠️ Apontamentos de Segurança:\n`;
      staticFindings.forEach((f, i) => {
        report += `${i + 1}. **[${f.severity}]** \`${f.file}:${f.line}\` — *${f.type}*: ${f.message}\n`;
      });
      report += `\n`;
    } else {
      report += `✔ Nenhuma exposição de credencial óbvia ou uso de eval() detectado na varredura estática.\n\n`;
    }

    if (llmAnalysis) {
      report += `### 🤖 Análise Semântica do Revisor (LLM):\n${llmAnalysis}\n`;
    } else {
      report += `> *Nota: Nenhuma chave de API configurada para análise semântica por LLM. Executada auditoria estática local baseada em padrões de segurança.*\n`;
    }

    return {
      success: true,
      report,
      findings: staticFindings,
      filesChecked: fileList.length
    };
  }

  async collectFiles(dir) {
    const files = [];

    async function walk(current) {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          files.push({
            fullPath: full,
            relPath: path.relative(dir, full).replace(/\\/g, '/')
          });
        }
      }
    }

    await walk(dir);
    return files;
  }
}

