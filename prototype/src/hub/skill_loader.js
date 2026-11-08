import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Carregador Global de Skills
 * Varre os diretórios de skills (global e de projeto) e disponibiliza as diretrizes para qualquer agente/modelo.
 */
export class SkillLoader {
  constructor(registry, skillsDirs = []) {
    this.registry = registry;
    this.skillsDirs = Array.isArray(skillsDirs) ? skillsDirs : [skillsDirs];
    this.skills = new Map();
  }

  async loadAll() {
    for (const dir of this.skillsDirs) {
      if (!dir) continue;
      try {
        await fs.mkdir(dir, { recursive: true });
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const skillPath = path.join(dir, entry.name);
            const content = await fs.readFile(skillPath, 'utf-8');
            const skillName = path.basename(entry.name, '.md').toLowerCase();

            this.skills.set(skillName, {
              name: skillName,
              file: entry.name,
              dir,
              content
            });
          }
        }
      } catch (err) {
        // Ignora erros de leitura de pastas vazias
      }
    }

    // Registra a ferramenta unificada de consulta de skills
    this.registry.register({
      name: 'consult_skill',
      description: 'Consulta uma habilidade técnica (Skill) global detalhada por nome para obter melhores práticas e diretrizes.',
      parameters: {
        type: 'object',
        properties: {
          skillName: {
            type: 'string',
            description: `Nome da skill a consultar. Disponíveis: ${Array.from(this.skills.keys()).join(', ') || 'nenhuma no momento'}`
          }
        },
        required: ['skillName']
      },
      source: 'skill_system',
      execute: async ({ skillName }) => {
        const key = (skillName || '').toLowerCase().trim();
        const found = this.skills.get(key);
        if (!found) {
          return {
            error: `Skill '${skillName}' não encontrada.`,
            available: Array.from(this.skills.keys())
          };
        }
        return {
          skill: found.name,
          instructions: found.content
        };
      }
    });

    return Array.from(this.skills.keys());
  }

  listSkills() {
    return Array.from(this.skills.keys());
  }
}
