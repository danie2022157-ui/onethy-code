import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Cliente Universal para Servidores Model Context Protocol (MCP)
 * Descobre ferramentas dos servidores configurados e as injeta no Registro Global.
 */
export class McpClientManager {
  constructor(registry) {
    this.registry = registry;
    this.processes = new Map();
  }

  /**
   * Inicializa servidores configurados
   * @param {string} configFilePath
   */
  async initFromConfig(configFilePath) {
    try {
      const raw = await fs.readFile(configFilePath, 'utf-8');
      const config = JSON.parse(raw);
      if (!Array.isArray(config.servers)) return;

      for (const server of config.servers) {
        if (server.enabled) {
          await this.connectServer(server).catch(err => {
            console.warn(`[MCP Warning] Não foi possível iniciar servidor '${server.id}': ${err.message}`);
          });
        }
      }
    } catch (err) {
      // Arquivo de configuração ausente ou inválido
    }
  }

  /**
   * Conecta a um servidor MCP via stdio
   */
  async connectServer(serverConfig) {
    const { id, command, args = [], env = {} } = serverConfig;

    const execCmd = process.platform === 'win32' && command === 'npx' ? 'npx.cmd' : command;

    return new Promise((resolve) => {
      // Inicia o processo do servidor MCP
      const proc = spawn(execCmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        shell: false
      });

      this.processes.set(id, proc);

      let buffer = '';
      let initialized = false;

      // Listener de saída do servidor
      proc.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Mantém o que sobrou

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            this.handleMcpMessage(id, message);
          } catch {
            // Ignora logs brutos que não são JSON-RPC
          }
        }
      });

      proc.stderr.on('data', () => {
        // Logs de erro do servidor
      });

      // Envia requisição initialize JSON-RPC
      const initReq = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'omni-orchestrator', version: '1.0.0' }
        }
      };

      try {
        proc.stdin.write(JSON.stringify(initReq) + '\n');
        // Solicita lista de ferramentas
        const listReq = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {}
        };
        setTimeout(() => {
          try {
            proc.stdin.write(JSON.stringify(listReq) + '\n');
          } catch {}
          resolve();
        }, 500);
      } catch (err) {
        resolve();
      }
    });
  }

  handleMcpMessage(serverId, message) {
    if (message.id === 2 && message.result && Array.isArray(message.result.tools)) {
      for (const tool of message.result.tools) {
        const globalToolName = `mcp_${serverId}_${tool.name}`;
        this.registry.register({
          name: globalToolName,
          description: `[MCP: ${serverId}] ${tool.description || ''}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
          source: `mcp:${serverId}`,
          execute: async (args) => {
            return await this.callMcpTool(serverId, tool.name, args);
          }
        });
      }
    }
  }

  async callMcpTool(serverId, toolName, args) {
    const proc = this.processes.get(serverId);
    if (!proc) {
      throw new Error(`Servidor MCP '${serverId}' não está em execução.`);
    }

    return new Promise((resolve) => {
      const reqId = Date.now();
      const callMsg = {
        jsonrpc: '2.0',
        id: reqId,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      };

      const onData = (data) => {
        const text = data.toString();
        try {
          const res = JSON.parse(text);
          if (res.id === reqId) {
            proc.stdout.off('data', onData);
            resolve(res.result || res.error);
          }
        } catch {}
      };

      proc.stdout.on('data', onData);
      proc.stdin.write(JSON.stringify(callMsg) + '\n');

      setTimeout(() => {
        proc.stdout.off('data', onData);
        resolve({ timeout: true, message: `Chamada da ferramenta MCP excedeu o tempo limite.` });
      }, 30000);
    });
  }

  destroy() {
    for (const [id, proc] of this.processes.entries()) {
      try {
        proc.kill();
      } catch {}
    }
  }
}
