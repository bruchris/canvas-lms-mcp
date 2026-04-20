import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildToolManifest, buildWorkflowManifest } from '../src/discovery/manifests'

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const outputDir = resolve('docs/generated')

  await mkdir(outputDir, { recursive: true })
  await writeJson(resolve(outputDir, 'tool-manifest.json'), buildToolManifest())
  await writeJson(resolve(outputDir, 'workflow-manifest.json'), buildWorkflowManifest())
}

await main()
