function fitRoute() {
  if (!mapReady || !journey) return;

  const coordinates = unwrapRoute(journey.route.points);
  if (!coordinates.length) return;

  const bounds = coordinates.reduce(
    (result, coordinate) => result.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
  );

  const refit = () => {
    map.resize();

    map.fitBounds(bounds, {
      padding: {
        top: 75,
        right: 75,
        bottom: 75,
        left: 75
      },
      maxZoom: 9,
      duration: 500
    });
  };

  requestAnimationFrame(refit);
  setTimeout(refit, 300);
  setTimeout(refit, 1000);
}
