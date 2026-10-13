import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildGeneratedSkills, renderGeneratedModule } from '../src/prompts/generate'

async function main(): Promise<void> {
  const skills = buildGeneratedSkills()
  const source = await renderGeneratedModule(skills)
  await writeFile(resolve('src/prompts/skills.generated.ts'), source, 'utf8')
  console.log(`Generated ${skills.length} skill prompts.`)
}

await main()
