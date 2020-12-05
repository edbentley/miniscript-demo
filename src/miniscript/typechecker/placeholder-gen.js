let placeholderGeneratorCounter = 0;
const getNextPlaceholderVar = () => {
  placeholderGeneratorCounter += 1;
  return `?X${placeholderGeneratorCounter}`;
};

module.exports = {
  getNextPlaceholderVar,
};
