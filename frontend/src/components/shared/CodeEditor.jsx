import Editor from '@monaco-editor/react'

function CodeEditor({ value, language, height = 240, onChange }) {
  return (
    <div
      className="monaco-editor-shell"
      style={{ height }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Editor
        value={value || ''}
        language={language}
        theme="vs-dark"
        onChange={(nextValue) => onChange(nextValue || '')}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          wordWrap: 'on',
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  )
}

export default CodeEditor
