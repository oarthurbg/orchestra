from .words import greet


class Host:
    def open(self, guest):
        print(greet(guest))
