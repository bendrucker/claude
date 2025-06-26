import { query } from '@anthropic-ai/claude-code';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeResult, EvalStatus } from '../eval/result';
import { ClaudeEvalResponse } from './types';
import { ClaudeClientInterface } from './interface';
import { debug, log, debugEnabled } from '../cli';

interface AnthropicModel {
  id: string;
  display_name: string;
  created_at: string;
  type: string;
}

interface AnthropicModelData {
  id: string;
  display_name?: string;
  created_at: string;
  type: string;
}

interface LocalTextBlock {
  type: 'text';
  text: string;
}

type ContentBlockType = LocalTextBlock | { type: string; [key: string]: unknown };

interface QueryOptions {
  maxTurns: number;
  model?: string;
}

export class ClaudeClient implements ClaudeClientInterface {
  private static modelCache: AnthropicModel[] | null = null;
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  async getAvailableModels(): Promise<AnthropicModel[]> {
    if (ClaudeClient.modelCache) {
      return ClaudeClient.modelCache;
    }

    try {
      const response = await this.anthropic.models.list();
      const models = response.data.map((model: AnthropicModelData) => ({
        id: model.id,
        display_name: model.display_name || model.id,
        created_at: model.created_at,
        type: model.type
      }));
      
      ClaudeClient.modelCache = models;
      debug('models-fetched', 'Available models retrieved', { count: models.length });
      return models;
    } catch (error) {
      debug('models-error', 'Failed to fetch models', { error: String(error) });
      // Fallback to hardcoded models
      const fallbackModels = [
        { id: 'claude-sonnet-4-20250514', display_name: 'Claude 3.5 Sonnet', created_at: '2024-01-01', type: 'model' },
        { id: 'claude-opus-4-20250514', display_name: 'Claude 3 Opus', created_at: '2024-01-01', type: 'model' }
      ];
      ClaudeClient.modelCache = fallbackModels;
      return fallbackModels;
    }
  }

  private async getModelName(model?: string): Promise<string | undefined> {
    if (!model) return undefined;
    
    // If it looks like a full model name, use it directly
    if (model.startsWith('claude-')) {
      return model;
    }
    
    // Discover latest models by family
    const models = await this.getAvailableModels();
    const familyMap: Record<string, string> = {
      'sonnet-4': 'sonnet-4',
      'opus-4': 'opus-4'
    };
    
    const family = familyMap[model];
    if (!family) return undefined;

    // Find the latest model in the family (assuming newer dates = better)
    const familyModels = models.filter(m => m.id.includes(family));
    if (familyModels.length === 0) return undefined;

    const latest = familyModels.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    debug('model-resolved', 'Resolved model family', { family, resolved: latest.id });
    return latest.id;
  }

  async evaluate(prompt: string, model?: string): Promise<ClaudeResult> {
    try {
      const messages: string[] = [];
      const modelName = await this.getModelName(model);

      debug('claude-query', 'Starting evaluation', { maxTurns: 3, model: modelName });

      const options: QueryOptions = { maxTurns: 3 };
      if (modelName) {
        options.model = modelName;
      }

      for await (const message of query({
        prompt,
        options
      })) {
        debug('claude-message', 'Received message', { message });

        // Extract content from assistant messages
        if (message.type === 'assistant' && message.message.content) {
          const content = Array.isArray(message.message.content)
            ? message.message.content.map((block: unknown) => {
                const typedBlock = block as ContentBlockType;
                return typedBlock.type === 'text' ? (typedBlock as LocalTextBlock).text : '';
              }).join('')
            : message.message.content;


          if (!this.looksLikeJson(content) && !debugEnabled) {
            process.stdout.write(content);
          }
          messages.push(content);
        }

        // Capture successful result messages as final output
        if (message.type === 'result') {
          if (message.subtype === 'success') {
            const content = message.result;
            debug('claude-result', 'Success result', { content });
            messages.length = 0;
            messages.push(content);
          } else {
            log('error', 'claude-result', 'Query failed', { 
              subtype: message.subtype,
              turns: message.num_turns, 
              is_error: message.is_error 
            });
          }
        }
      }

      const fullContent = messages.join('');
      const response = this.parseJsonResponse(fullContent);

      return {
        content: response.summary,
        status: this.mapStatus(response.status),
        response
      };
    } catch (error) {
      log('error', 'claude-evaluation', 'Evaluation failed', { error: String(error) });
      throw new Error(`Claude evaluation failed: ${error}`);
    }
  }

  private parseJsonResponse(content: string): ClaudeEvalResponse {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      debug('claude-parse', 'No JSON object found', { content });
      throw new Error('No JSON response found in Claude output');
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return this.validateResponse(parsed);
    } catch (error) {
      debug('claude-parse', 'JSON parse failed', { error: String(error), json: jsonMatch[0] });
      throw new Error(`Invalid JSON response: ${error}`);
    }
  }

  private validateResponse(response: unknown): ClaudeEvalResponse {
    if (!response || typeof response !== 'object') {
      throw new Error('Response must be an object');
    }

    const obj = response as Record<string, unknown>;

    if (!obj.status || !['success', 'violations', 'error'].includes(obj.status as string)) {
      throw new Error('Invalid or missing status in response');
    }

    if (!obj.summary || typeof obj.summary !== 'string') {
      throw new Error('Invalid or missing summary in response');
    }

    // Set defaults for missing optional fields
    return {
      status: obj.status as 'success' | 'violations' | 'error',
      summary: obj.summary,
      issues: Array.isArray(obj.issues) ? obj.issues as ClaudeEvalResponse['issues'] : [],
      metadata: (obj.metadata as ClaudeEvalResponse['metadata']) || { filesEvaluated: 0 }
    };
  }

  private mapStatus(status: string): EvalStatus {
    switch (status) {
      case 'success': return EvalStatus.Success;
      case 'violations': return EvalStatus.Violations;
      case 'error': return EvalStatus.Error;
      default: return EvalStatus.Error;
    }
  }

  private looksLikeJson(content: string): boolean {
    return content.trim().startsWith('{') || content.includes('```json');
  }
}
