import { greet } from './greet'

export class Host {
  open(guest: string) {
    console.log(greet(guest))
  }
}
