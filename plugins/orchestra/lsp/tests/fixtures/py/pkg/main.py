from .host import Host
from .welcome import welcome


def main():
    welcome("guest")
    Host().open("guest")
