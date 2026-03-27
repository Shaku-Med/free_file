package env

import "log"

func Logger(name string, value string) {
	log.Printf("%s: %s", name, value)
}