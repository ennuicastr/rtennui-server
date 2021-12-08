all: src/main.js

src/main.js: src/*.ts node_modules/.bin/tsc
	./node_modules/.bin/tsc -p .

node_modules/.bin/tsc:
	npm install

clean:
	rm -f src/*.js
