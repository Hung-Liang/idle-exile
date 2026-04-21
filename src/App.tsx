
import IdleGame from './components/IdleGame'

function App() {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#f9f9f9', minHeight: '100vh' }}>
      <header style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1>Project Idle Exile</h1>
      </header>
      <main>
        <IdleGame />
      </main>
    </div>
  )
}

export default App
