import { resolve, dirname, relative } from 'path'
import fs from 'fs/promises'
import { createFilter } from '@rollup/pluginutils'
import { normalizePath } from 'vite'
import { Project } from 'ts-morph'
import { mergeObjects } from './utils'

import type { Plugin } from 'vite'
// import type { ExternalOption } from 'rollup'
import type { ProjectOptions, SourceFile } from 'ts-morph'

type FilterType = string | RegExp | (string | RegExp)[] | null | undefined

export interface PluginOptions {
  include?: FilterType,
  exclude?: FilterType,
  root?: string,
  projectOptions?: ProjectOptions | null,
  cleanVueFileName?: boolean
}

export default (options: PluginOptions = {}): Plugin => {
  const {
    include = ['**/*.vue', '**/*.ts', '**/*.tsx'],
    exclude = 'node_modules/**',
    root = process.cwd(),
    projectOptions = null,
    cleanVueFileName = false
  } = options

  const filter = createFilter(include, exclude)

  const sourceFiles: SourceFile[] = []

  // let external: ExternalOption | undefined
  // let entry: string

  const project = new Project(
    mergeObjects(
      {
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          noEmitOnError: true
        },
        tsConfigFilePath: resolve(root, 'tsconfig.json'),
        skipAddingFilesFromTsConfig: true
      },
      projectOptions ?? {}
    )
  )

  return {
    name: 'vite:dts',

    apply: 'build',

    enforce: 'post',

    // configResolved(resolvedConfig) {
    //   // external = resolvedConfig?.build?.rollupOptions?.external ?? undefined
    //   // const lib = resolvedConfig?.build?.lib

    //   // if (lib) {
    //   //   entry = lib.entry
    //   // } else {
    //   //   const input = resolvedConfig?.build?.rollupOptions?.input

    //   //   entry = typeof input === 'string' ? input : ''
    //   // }
    // },

    transform(code, id) {
      if (!code || !filter(id)) return null

      if (/\.vue(\?.*type=script.*)$/.test(id)) {
        const filePath = resolve(root, normalizePath(id.split('?')[0]))

        sourceFiles.push(
          project.createSourceFile(filePath + (/lang.ts/.test(id) ? '.ts' : '.js'), code)
        )
      } else if (/\.tsx?$/.test(id)) {
        const filePath = resolve(root, normalizePath(id))

        sourceFiles.push(project.addSourceFileAtPath(filePath))
      }
    },

    async generateBundle(outputOptions) {
      const declarationDir = (
        outputOptions.file ? dirname(outputOptions.file) : outputOptions.dir
      ) as string
      const diagnostics = project.getPreEmitDiagnostics()

      console.log(project.formatDiagnosticsWithColorAndContext(diagnostics))

      project.emitToMemory()

      for (const sourceFile of sourceFiles) {
        const emitOutput = sourceFile.getEmitOutput()

        for (const outputFile of emitOutput.getOutputFiles()) {
          const filePath = outputFile.getFilePath()
          const content = outputFile.getText()
          const targetPath = resolve(
            declarationDir,
            relative(root, cleanVueFileName ? filePath.replace('.vue.d.ts', '.d.ts') : filePath)
          )

          await fs.mkdir(dirname(targetPath), { recursive: true })
          await fs.writeFile(
            targetPath,
            cleanVueFileName ? content.replace(/['"](.+)\.vue['"]/g, '"$1"') : content,
            'utf8'
          )
        }
      }
    }
  }
}