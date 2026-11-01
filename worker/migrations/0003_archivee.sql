-- Date du passage dans l'archive sans note (« archiver sans note ») : elle tient
-- lieu de date de la dernière note pour trier l'archive et l'afficher.
alter table oeuvres add column archivee integer;
