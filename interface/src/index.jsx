/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import ConsoleRoot from './ConsoleRoot.jsx'

const root = document.getElementById('root')

render(() => <ConsoleRoot />, root)
