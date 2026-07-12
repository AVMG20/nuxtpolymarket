// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    rules: {
      // Formatting is left to the editor, not enforced by ESLint. These rules
      // conflict wholesale with the existing code style, so keep them off.
      '@stylistic/indent': 'off',
      '@stylistic/no-multi-spaces': 'off',
      '@stylistic/comma-dangle': 'off',
      '@stylistic/member-delimiter-style': 'off',
      '@stylistic/max-statements-per-line': 'off',
      '@stylistic/key-spacing': 'off',
      '@stylistic/quote-props': 'off',
      '@stylistic/object-curly-spacing': 'off',
      '@stylistic/arrow-parens': 'off',
      '@stylistic/brace-style': 'off',
      '@stylistic/quotes': 'off',
      '@stylistic/semi': 'off',
      '@stylistic/eol-last': 'off',
      '@stylistic/no-multiple-empty-lines': 'off',
      '@stylistic/comma-spacing': 'off',
      '@stylistic/indent-binary-ops': 'off',
      '@stylistic/operator-linebreak': 'off',
      '@stylistic/type-annotation-spacing': 'off',
      '@stylistic/space-in-parens': 'off',
      '@stylistic/space-before-function-paren': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/attributes-order': 'off',
      'vue/comma-dangle': 'off',
      'vue/comma-spacing': 'off',
      'vue/block-tag-newline': 'off',
      'vue/brace-style': 'off',
      'import/newline-after-import': 'off',

      // Genuine code-quality signals: keep them visible but non-blocking so a
      // pre-existing violation doesn't fail CI.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-dynamic-delete': 'warn',
      'vue/no-multiple-template-root': 'warn',
      'vue/no-deprecated-slot-attribute': 'warn',
      'no-empty': 'warn'
    }
  }
)
