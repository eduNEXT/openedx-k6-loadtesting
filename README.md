# OpenedX Load Tests with K6

[K6](https://k6.io/) is a widely used tool to perform load testing. It
is open-source, relies on a large [community](https://community.k6.io/),
and it's backed by Grafana labs.

## Pre-requisites

- [Node.js](https://nodejs.org/en/download/): Optional for development
  purposes.
- [K6](https://k6.io/docs/get-started/installation/): Required to run
  the tests.
- [Demo Course](https://github.com/openedx/openedx-demo-course): A
  course to be used in the tests.
- Automatic auth: Enable `AUTOMATIC_AUTH_FOR_TESTING` feature flag to allow
  vus to login.

## Installing

See the [K6 installation guide](https://k6.io/docs/get-started/installation/)
for installation instructions.

## Running the tests

```bash
$ K6_WEB_DASHBOARD=true k6 run <test_file_name>.js -e PROFILE=<profile_file_path>
# e.g
$ K6_WEB_DASHBOARD=true k6 run basic_lms_load_test.js -e PROFILE=default.json
```

The `PROFILE` environment variable is used to load the configuration
file for the tests. You can find an example in the `./default.json`
file. You can create your own profile file to customize the tests
according to your needs. Your profile file will override the default
values if they are present.

The `K6_WEB_DASHBOARD` environment variable is used to enable the web
dashboard. You can access it by opening the URL shown in the terminal
after running the tests.

## Results

The results of the tests are shown in the terminal. You can also access
the web dashboard to see the results in a more visual way.

Make sure to check the [K6 documentation](https://k6.io/docs/get-started/results-output/)
and the [Results output section](https://grafana.com/docs/k6/latest/results-output/)
to learn more about the results and how to interpret them and

## Developing

To contribute to this project, you need to follow the steps below:

- Install the project dependencies:

```bash
$ make requirements
```

- Create a new test file in the [tests]{.title-ref} directory. You can
  use the [basic_lms_load_test.js]{.title-ref} as a template.
- Run the tests with your profile. You can use the [basic]{.title-ref}
  profile as a template.:

```bash
$ k6 run <test_file_name>.js -e PROFILE=<profile_path>
```

- Make sure to format your code before submitting a pull request:

```bash
$ make lint
```

## For the future

Feel free to explore the K6 [documentation](https://k6.io/docs/) to get
further information and learn more about advanced features.

TODO:

- Implement a strategy to run the tests in a more automated way, using
  remote instances.
- Define a template for test descriptions.
- Make tests more flexible and configurable.
