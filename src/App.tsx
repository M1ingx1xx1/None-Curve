const pipeline = [
  {
    step: 'Sound',
    zh: '声音',
    items: ['Volume', 'Pitch', 'Rhythm', 'Duration', 'Frequency', 'Texture'],
  },
  {
    step: 'Carving Logic',
    zh: '石刻逻辑',
    items: ['Depth', 'Pressure', 'Stroke Width', 'Edge Roughness', 'Erosion', 'Chisel Angle'],
  },
  {
    step: 'Letterform',
    zh: '字形',
    items: ['Polygon outline', 'Readable', 'Reproducible'],
  },
]

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>None-Curve</h1>
        <p>
          Turn font curves into editable polygon letterforms, with an optional sound-driven
          carving tool.
        </p>
        <p className="zh">将字体曲线转换为可编辑多边形，并可选用声音驱动的石刻工具。</p>
      </header>

      <main className="workspace">
        <aside className="panel" aria-label="Controls">
          <h2>Controls</h2>
          <p className="muted">No font loaded. Font import is not available yet.</p>
        </aside>

        <section className="canvas" aria-label="Preview">
          <ol className="pipeline">
            {pipeline.map((stage, i) => (
              <li key={stage.step} className="stage">
                <span className="index">{String(i + 1).padStart(2, '0')}</span>
                <h3>
                  {stage.step} <span className="zh">{stage.zh}</span>
                </h3>
                <ul>
                  {stage.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="muted">Placeholder — font, geometry, and audio features are planned.</p>
        </section>
      </main>
    </div>
  )
}
