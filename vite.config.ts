import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { generateScienceArtifactInternal } from './services/geminiService';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'local-edge-generate-artifact',
          configureServer(server) {
            server.middlewares.use('/api/generate-artifact', (req, res) => {
              if (req.method !== 'POST') {
                res.statusCode = 405;
                res.end('Method Not Allowed');
                return;
              }

              let body = '';
              req.on('data', (chunk) => {
                body += chunk;
              });

              req.on('end', async () => {
                try {
                  const parsed = body ? JSON.parse(body) : {};
                  const prompt = parsed.prompt || '';
                  const images = Array.isArray(parsed.images) ? parsed.images : [];
                  const modelConfig = parsed.modelConfig;
                  const currentArtifact = parsed.currentArtifact || null;
                  const history = Array.isArray(parsed.history) ? parsed.history : [];

                  const result = await generateScienceArtifactInternal(
                    prompt,
                    images,
                    modelConfig,
                    currentArtifact,
                    history
                  );

                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(result));
                } catch (e: any) {
                  res.statusCode = 500;
                  const message = e instanceof Error ? e.message : String(e);
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: message }));
                }
              });
            });
          }
        }
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.ZAI_API_KEY': JSON.stringify(env.ZAI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
