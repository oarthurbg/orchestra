import { Host } from './host'
import { welcome } from './welcome'

export function main() {
  welcome('guest')
  new Host().open('guest')
}
