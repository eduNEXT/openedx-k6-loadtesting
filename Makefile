requirements: # Install requirements
	npm install -D

lint: # Lint code with eslint
	npm run lint:format

quality: # Run eslint verification
	npm run lint:check
