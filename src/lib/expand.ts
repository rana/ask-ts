import { filterContent, shouldFilter } from './filter.ts';
import { loadConfig } from './config.ts';

export async function expandReferences(
  content: string
): Promise<{ expanded: string; fileCount: number }> {
  // Simple pattern - just match \[\[anything\]\]
  const pattern = /\[\[([^\]]+)\]\]/g
  let expanded = content
  let fileCount = 0
  
  for (const [match, ref] of content.matchAll(pattern)) {
    if (!ref) continue;
    
    try {
      const { text, files } = await expandReference(ref)
      expanded = expanded.replace(match, text)
      fileCount += files
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      expanded = expanded.replace(match, `\n❌ Error: ${ref} - ${message}\n`)
    }
  }
  
  return { expanded, fileCount }
}

async function expandReference(ref: string): Promise<{ text: string; files: number }> {
  const isRecursive = ref.endsWith('/**/')
  const isDirectory = ref.endsWith('/') || isRecursive
  
  if (!isDirectory) {
    try {
      const stat = await Bun.file(ref).stat()
      if (stat.isDirectory()) {
        return expandDirectory(ref, false)
      }
    } catch {
    }
  }
  
  if (isDirectory) {
    const dir = ref.replace(/\/?\*?\*?\/$/, '')
    return expandDirectory(dir, isRecursive)
  }
  
  return expandFile(ref)
}

async function expandFile(path: string): Promise<{ text: string; files: number }> {
  let actualPath = path;
  let file = Bun.file(path);
  
  if (!await file.exists()) {
    const lastSlash = path.lastIndexOf('/');
    const dir = lastSlash >= 0 ? path.substring(0, lastSlash) : '.';
    const filename = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    
    try {
      const dirPath = dir || '.';
      const entries = await Array.fromAsync(
        new Bun.Glob(`${dirPath}/*`).scan({ onlyFiles: true })
      );
      
      const match = entries.find(entry => {
        const entryName = entry.substring(entry.lastIndexOf('/') + 1);
        return entryName.toLowerCase() === filename.toLowerCase();
      });
      
      if (match) {
        actualPath = match;
        file = Bun.file(actualPath);
      } else {
        throw new Error('File not found');
      }
    } catch {
      throw new Error('File not found');
    }
  }
  
  const preview = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  if (preview.includes(0)) {
    throw new Error('Binary file');
  }
  
  let content = await file.text();
  
  // Apply filtering if enabled
  const config = await loadConfig();
  if (shouldFilter(config)) {
    content = filterContent(content, actualPath);
  }
  
  // Auto-escape any [[...]] patterns in the expanded content
  content = content.replace(/\[\[/g, '[\u200B[');
  content = content.replace(/\]\]/g, ']\u200B]');
  
  const lang = actualPath.split('.').pop() || '';
  
  const needsSixTicks = content.includes('```');
  const fence = needsSixTicks ? '``````' : '```';
  
  return {
    text: `\n### ${actualPath}\n${fence}${lang}\n${content}\n${fence}\n`,
    files: 1
  };
}

async function expandDirectory(
  path: string, 
  recursive: boolean
): Promise<{ text: string; files: number }> {
  const pattern = recursive ? `${path}/**/*` : `${path}/*`
  const glob = new Bun.Glob(pattern)
  
  const sections: string[] = []
  let fileCount = 0
  let hasSubdirs = false
  
  const skip = (path: string) => {
    const parts = path.split('/')
    return parts.some(p => 
      p === 'node_modules' || 
      p === '.git' || 
      p.startsWith('.')
    )
  }
  
  if (!recursive) {
    for await (const entry of new Bun.Glob(`${path}/*`).scan()) {
      if (skip(entry)) continue
      const stat = await Bun.file(entry).stat()
      if (stat.isDirectory()) {
        hasSubdirs = true
        break
      }
    }
  }
  
  for await (const filePath of glob.scan({ onlyFiles: true })) {
    if (skip(filePath)) continue
    
    try {
      const { text } = await expandFile(filePath)
      sections.push(text)
      fileCount++
    } catch {
      continue
    }
  }
  
  if (sections.length === 0) {
    if (hasSubdirs) {
      return {
        text: `\n### ${path}/\n\n*(contains only subdirectories - use \[\[${path}/**/\]\] for recursive)*\n`,
        files: 0
      }
    } else {
      return {
        text: `\n### ${path}/\n\n*(empty directory)*\n`,
        files: 0
      }
    }
  }
  
  return { 
    text: sections.join(''), 
    files: fileCount 
  }
}